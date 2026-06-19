import mongoose from 'mongoose';
import type { ChangeStream } from 'mongodb';
import type { Server as SocketIOServer } from 'socket.io';
import Note from '../models/Note';
import Task from '../models/Task';
import logger from '../utils/logger';

type WatchableModel = { collection: { collectionName: string }; watch: (...args: any[]) => ChangeStream };

type Registration = {
  model: WatchableModel;
  resourceLabel: 'note' | 'task';
};

const REGISTRATIONS: Registration[] = [
  { model: Note as unknown as WatchableModel, resourceLabel: 'note' },
  { model: Task as unknown as WatchableModel, resourceLabel: 'task' },
];

const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
// Give up after this many consecutive restart attempts. A permanent fault (no replica-set
// access, mis-config) would otherwise restart every 30s forever, spamming the logs and never
// recovering. After the cap we stop retrying and flip a degraded flag so ops can see it.
const RESTART_MAX_ATTEMPTS = 10;

let started = false;
let degraded = false;
const streams: ChangeStream[] = [];

/**
 * Decide what to do after a change-stream error, given how many restart attempts have already
 * happened. Pure + exported for tests. Exponential backoff capped at RESTART_MAX_DELAY_MS, then a
 * hard stop at RESTART_MAX_ATTEMPTS so a permanent fault can't loop forever.
 */
export const planChangeStreamRestart = (attempts: number): { giveUp: boolean; delayMs: number } => {
  if (attempts >= RESTART_MAX_ATTEMPTS) return { giveUp: true, delayMs: 0 };
  return { giveUp: false, delayMs: Math.min(RESTART_BASE_DELAY_MS * 2 ** attempts, RESTART_MAX_DELAY_MS) };
};

/** True once a change stream has exhausted its restart budget and stopped retrying (for /health). */
export const isChangeStreamDegraded = (): boolean => degraded;

const isReplicaSet = async (): Promise<boolean> => {
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.db) return false;
    const admin = conn.db.admin();
    const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    return Boolean(info?.setName) || info?.msg === 'isdbgrid';
  } catch {
    return false;
  }
};

const extractUserIdFromChange = (change: any): string | null => {
  // fullDocument is present on insert/replace and on update when updateLookup is set.
  const userId = change?.fullDocument?.userId;
  if (typeof userId === 'string' && userId.length > 0) return userId;
  return null;
};

export const installSingleStream = (io: SocketIOServer, reg: Registration, restartAttempts = 0): void => {
  try {
    const cs = reg.model.watch([], { fullDocument: 'updateLookup' });
    streams.push(cs);

    cs.on('change', (change: any) => {
      try {
        const userId = extractUserIdFromChange(change);
        if (!userId) return; // Without a tenant scope we cannot safely fan out.
        const docId = String(change?.documentKey?._id ?? '');
        const op = String(change?.operationType ?? '');
        io.to(`user:${userId}`).emit('cache:invalidate', {
          resource: reg.resourceLabel,
          op,
          id: docId,
          ts: Date.now(),
        });
      } catch (err) {
        logger.warn('changeStream.emit-failed', {
          resource: reg.resourceLabel,
          error: (err as Error)?.message,
        });
      }
    });

    cs.on('error', (err: unknown) => {
      // Drop this now-dead stream from the tracked list so the array can't grow unbounded
      // across restarts (every restart used to push a new stream and never remove the old one).
      const idx = streams.indexOf(cs);
      if (idx >= 0) streams.splice(idx, 1);
      try { cs.close(); } catch { /* noop */ }

      const plan = planChangeStreamRestart(restartAttempts + 1);
      if (plan.giveUp) {
        degraded = true;
        logger.error('changeStream.gave-up', {
          resource: reg.resourceLabel,
          error: (err as Error)?.message,
          attempts: restartAttempts + 1,
        });
        return; // stop retrying — no infinite loop / log spam on a permanent fault
      }
      logger.warn('changeStream.error-restarting', {
        resource: reg.resourceLabel,
        error: (err as Error)?.message,
        attempt: restartAttempts + 1,
        nextAttemptMs: plan.delayMs,
      });
      setTimeout(() => installSingleStream(io, reg, restartAttempts + 1), plan.delayMs);
    });
  } catch (err) {
    logger.error('changeStream.install-failed', {
      resource: reg.resourceLabel,
      error: (err as Error)?.message,
    });
  }
};

export const startChangeStreamInvalidator = async (io: SocketIOServer): Promise<void> => {
  if (started) return;
  if (process.env.DISABLE_CHANGE_STREAMS === 'true') {
    logger.info('changeStream disabled via DISABLE_CHANGE_STREAMS=true');
    return;
  }
  const replica = await isReplicaSet();
  if (!replica) {
    logger.info('changeStream skipped: not a replica set / sharded cluster');
    return;
  }
  started = true;
  degraded = false;
  for (const reg of REGISTRATIONS) {
    installSingleStream(io, reg);
  }
  logger.info('changeStream invalidator started', { collections: REGISTRATIONS.map((r) => r.resourceLabel) });
};

export const stopChangeStreamInvalidator = async (): Promise<void> => {
  for (const cs of streams) {
    try { await cs.close(); } catch { /* noop */ }
  }
  streams.length = 0;
  started = false;
  degraded = false;
};

/** Number of live change streams currently tracked (diagnostics / tests). */
export const changeStreamCount = (): number => streams.length;
