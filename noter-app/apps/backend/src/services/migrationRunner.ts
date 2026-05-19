import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import logger from '../utils/logger';
import { withLock, LockUnavailableError } from './distributedLock';

/**
 * Versioned, idempotent migration runner.
 *
 * Each migration has:
 *   - `id` — stable string (e.g., `2026-05-19-add-task-priority-index`)
 *   - `up(db)` — async function performing the change
 *
 * Applied migrations are recorded in the `_migrations` collection. The
 * runner skips any id already present and applies missing ones in
 * declaration order. The whole batch runs inside a distributed lock named
 * `migration-runner` so two backends starting simultaneously don't
 * race on the same migration.
 *
 * Reversibility: a migration that ALREADY ran but fails on re-run
 * (because state changed unexpectedly) won't be re-attempted — the row
 * in `_migrations` says it's done. To re-run, manually delete the row
 * after fixing the migration.
 */

const COLLECTION = '_migrations';
const LOCK_KEY = 'migration-runner';
const LOCK_TTL_SEC = 5 * 60;

export interface Migration {
  id: string;
  /** Description shown in logs. Optional. */
  description?: string;
  /** Apply the migration. Should be idempotent — the runner skips on success-then-retry. */
  up: (db: Db) => Promise<void>;
}

interface MigrationRecord {
  id: string;
  appliedAt: Date;
  description?: string;
  durationMs: number;
}

const ID_PATTERN = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{1,127}$/;

const validateMigrations = (migrations: Migration[]): void => {
  const seen = new Set<string>();
  for (const m of migrations) {
    if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
      throw new Error(`migration id "${m.id}" is invalid (must match ${ID_PATTERN})`);
    }
    if (seen.has(m.id)) {
      throw new Error(`duplicate migration id: ${m.id}`);
    }
    seen.add(m.id);
    if (typeof m.up !== 'function') {
      throw new Error(`migration "${m.id}" missing up() function`);
    }
  }
};

export interface RunOptions {
  /** Don't apply, just print what would run. */
  dryRun?: boolean;
}

export interface RunResult {
  applied: Array<{ id: string; durationMs: number }>;
  skipped: string[];
  failed: { id: string; error: string } | null;
}

const getDb = (): Db => {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) {
    throw new Error('mongo not connected');
  }
  return conn.db as Db;
};

export const runMigrations = async (migrations: Migration[], opts: RunOptions = {}): Promise<RunResult> => {
  validateMigrations(migrations);
  const db = getDb();
  const coll = db.collection<MigrationRecord>(COLLECTION);
  // Ensure unique index on id so concurrent runners can't double-apply.
  await coll.createIndex({ id: 1 }, { unique: true }).catch(() => undefined);

  const acquired = await coll.find({ id: { $in: migrations.map((m) => m.id) } }).toArray();
  const appliedIds = new Set(acquired.map((r) => r.id));

  const pending = migrations.filter((m) => !appliedIds.has(m.id));

  if (opts.dryRun) {
    logger.info('migration: dry-run', { pending: pending.map((m) => m.id) });
    return {
      applied: [],
      skipped: migrations.filter((m) => appliedIds.has(m.id)).map((m) => m.id),
      failed: null,
    };
  }

  if (pending.length === 0) {
    return { applied: [], skipped: migrations.map((m) => m.id), failed: null };
  }

  try {
    return await withLock(LOCK_KEY, async () => {
      const applied: Array<{ id: string; durationMs: number }> = [];
      let failed: RunResult['failed'] = null;
      for (const m of pending) {
        // Re-check inside the lock — another process might have applied this
        // between our list-read and our lock-acquire.
        const exists = await coll.findOne({ id: m.id });
        if (exists) continue;
        const start = Date.now();
        try {
          await m.up(db);
          const durationMs = Date.now() - start;
          await coll.insertOne({
            id: m.id,
            appliedAt: new Date(),
            description: m.description,
            durationMs,
          });
          applied.push({ id: m.id, durationMs });
          logger.info('migration: applied', { id: m.id, durationMs });
        } catch (err) {
          failed = { id: m.id, error: (err as Error)?.message ?? 'unknown' };
          logger.error('migration: failed', { id: m.id, error: failed.error });
          break;
        }
      }
      return {
        applied,
        skipped: migrations.filter((m) => appliedIds.has(m.id)).map((m) => m.id),
        failed,
      };
    }, { ttlSeconds: LOCK_TTL_SEC });
  } catch (err) {
    if (err instanceof LockUnavailableError) {
      logger.warn('migration: another runner holds the lock; skipping this round');
      return { applied: [], skipped: [], failed: null };
    }
    throw err;
  }
};

export const _validateMigrations = validateMigrations;
