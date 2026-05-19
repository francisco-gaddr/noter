import mongoose from 'mongoose';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import logger from '../utils/logger';

/**
 * Backend instance heartbeat. Each running backend writes a record to a
 * dedicated `_instances` collection every 15s with:
 *   - instanceId (random per process)
 *   - hostname, pid, version
 *   - boot time, last heartbeat
 *
 * Why: in dev it's easy to accidentally point two backends at the same
 * Mongo (e.g., one in nodemon, one already running on a server). They
 * silently both write — corrupting incremental sync state and producing
 * confusing duplicate change-stream events.
 *
 * At boot we list active heartbeats (those whose lastSeen is within 60s)
 * and log a warning if any are foreign. We don't block the start — the
 * operator might intentionally be running a blue-green pair — but the
 * warning is loud enough that misconfigurations don't go unnoticed.
 */

const COLLECTION = '_instances';
const HEARTBEAT_MS = 15_000;
const STALE_AFTER_MS = 60_000;

const instanceId = randomBytes(8).toString('hex');
const bootedAt = new Date().toISOString();

let timer: NodeJS.Timeout | null = null;

interface HeartbeatDoc {
  instanceId: string;
  hostname: string;
  pid: number;
  version: string;
  bootedAt: string;
  lastSeen: string;
  // Allow operators to tag their instances (canary, blue-green, etc.)
  tag?: string;
}

const buildDoc = (): HeartbeatDoc => ({
  instanceId,
  hostname: os.hostname(),
  pid: process.pid,
  version: process.env.npm_package_version ?? 'unknown',
  bootedAt,
  lastSeen: new Date().toISOString(),
  tag: process.env.INSTANCE_TAG,
});

const isLive = (lastSeen: string): boolean => {
  const t = Date.parse(lastSeen);
  return Number.isFinite(t) && Date.now() - t < STALE_AFTER_MS;
};

export const startInstanceHeartbeat = async (): Promise<void> => {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) {
    logger.info('instance-heartbeat: mongo not ready, skipping');
    return;
  }
  if (process.env.DISABLE_INSTANCE_HEARTBEAT === 'true') {
    logger.info('instance-heartbeat: disabled via env');
    return;
  }
  try {
    const coll = conn.db.collection<HeartbeatDoc>(COLLECTION);
    // Find currently-live peers (other instanceIds whose lastSeen is recent).
    const peers = await coll.find({}).limit(20).toArray();
    const livePeers = peers.filter((p) => p.instanceId !== instanceId && isLive(p.lastSeen));
    if (livePeers.length > 0) {
      logger.warn('instance-heartbeat: another backend is alive on this database', {
        instanceId,
        peers: livePeers.map((p) => ({
          instanceId: p.instanceId,
          hostname: p.hostname,
          pid: p.pid,
          version: p.version,
          tag: p.tag,
          lastSeenSecAgo: Math.round((Date.now() - Date.parse(p.lastSeen)) / 1000),
        })),
      });
    }

    // Write our initial heartbeat (upsert) and schedule the recurring update.
    const write = async () => {
      try {
        const doc = buildDoc();
        await coll.replaceOne({ instanceId }, doc, { upsert: true });
      } catch (err) {
        logger.warn('instance-heartbeat: write failed', { error: (err as Error)?.message });
      }
    };
    await write();
    timer = setInterval(write, HEARTBEAT_MS);
    timer.unref?.();
    logger.info('instance-heartbeat: started', { instanceId, intervalMs: HEARTBEAT_MS });
  } catch (err) {
    logger.warn('instance-heartbeat: setup failed', { error: (err as Error)?.message });
  }
};

export const stopInstanceHeartbeat = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Best-effort cleanup so the dead instance doesn't linger in the peer list.
  try {
    const conn = mongoose.connection;
    if (conn && conn.readyState === 1 && conn.db) {
      await conn.db.collection(COLLECTION).deleteOne({ instanceId });
    }
  } catch { /* noop */ }
};

export const getInstanceId = (): string => instanceId;
