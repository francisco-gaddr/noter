import NetInfo from '@react-native-community/netinfo';
import { kv } from './storage';

/**
 * Offline mutation queue.
 *
 * When a mutation fails because the user is offline (or the network is
 * flaky), we don't want them to lose the change. We enqueue it locally,
 * surface UI state ("Saved locally — will sync when online") and replay
 * once NetInfo reports a connection.
 *
 * Dedupe: queued items are keyed by (resource, id, op). Re-enqueueing the
 * same key replaces the previous payload rather than queueing twice — the
 * latest intent wins. For a delete after an update we collapse to just
 * the delete.
 *
 * Persistence: queue is mirrored to `kv` so it survives app restarts.
 * AsyncStorage today; MMKV-ready via the abstraction.
 *
 * The actual *executor* (what to do with each item) is injected by the
 * caller — this module owns the queue mechanics, not the network calls.
 */

const STORAGE_KEY = '__noter_offline_queue_v1__';
const MAX_ITEMS = 500;

export type QueuedOp = 'create' | 'update' | 'delete';

export interface QueuedMutation {
  /** Stable id of the queued operation; used for dedupe. */
  key: string;
  resource: 'note' | 'task';
  op: QueuedOp;
  /** Local/server id of the entity. */
  id: string;
  /** Operation payload — opaque to the queue; passed verbatim to the executor. */
  payload?: unknown;
  /** When the mutation was originally attempted. */
  queuedAt: string;
  /** How many times we've retried. */
  attempts: number;
}

let memory: QueuedMutation[] = [];
let loaded = false;
let executor: ((m: QueuedMutation) => Promise<void>) | null = null;
let flushInFlight = false;
let netUnsubscribe: (() => void) | null = null;

const persist = async (): Promise<void> => {
  try {
    await kv.setString(STORAGE_KEY, JSON.stringify(memory));
  } catch (err) {
    // Storage failures are not fatal — the in-memory queue still works
    // for the current session.
    // eslint-disable-next-line no-console
    console.warn('[offline-queue] persist failed', err);
  }
};

const hydrate = async (): Promise<void> => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await kv.getString(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      memory = parsed.filter((m): m is QueuedMutation =>
        m && typeof (m as QueuedMutation).key === 'string' && typeof (m as QueuedMutation).id === 'string'
      ).slice(0, MAX_ITEMS);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[offline-queue] hydrate failed', err);
    memory = [];
  }
};

export const setOfflineQueueExecutor = (fn: (m: QueuedMutation) => Promise<void>): void => {
  executor = fn;
};

const dedupeKey = (resource: string, id: string, op: QueuedOp): string => `${resource}:${id}:${op}`;

export const enqueue = async (input: Omit<QueuedMutation, 'queuedAt' | 'attempts' | 'key'> & { key?: string }): Promise<void> => {
  await hydrate();
  const key = input.key ?? dedupeKey(input.resource, input.id, input.op);
  // Special-case: a delete after an update should collapse — the update is
  // moot if we're going to delete the entity anyway.
  if (input.op === 'delete') {
    memory = memory.filter((m) => !(m.resource === input.resource && m.id === input.id));
  } else {
    // For non-delete ops, replace any prior item with the same key (latest wins).
    memory = memory.filter((m) => m.key !== key);
  }
  memory.push({
    key,
    resource: input.resource,
    op: input.op,
    id: input.id,
    payload: input.payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  // Hard cap so a runaway producer can't unbounded-fill storage.
  if (memory.length > MAX_ITEMS) {
    memory = memory.slice(-MAX_ITEMS);
  }
  await persist();
};

export const pending = async (): Promise<readonly QueuedMutation[]> => {
  await hydrate();
  return memory.slice();
};

export const clear = async (): Promise<void> => {
  memory = [];
  await persist();
};

/**
 * Attempt to drain the queue. Runs items in declared order, stops on the
 * first failure (so a transient network error doesn't keep nuking
 * attempts on subsequent items). Increments `attempts` on each failure
 * and drops items after MAX_ATTEMPTS so a permanently-failing item
 * doesn't block everything behind it forever.
 */
const MAX_ATTEMPTS = 5;
export const flush = async (): Promise<{ flushed: number; failed: number; dropped: number }> => {
  if (flushInFlight) return { flushed: 0, failed: 0, dropped: 0 };
  if (!executor) return { flushed: 0, failed: 0, dropped: 0 };
  flushInFlight = true;
  let flushed = 0;
  let failed = 0;
  let dropped = 0;
  try {
    await hydrate();
    while (memory.length > 0) {
      const next = memory[0];
      try {
        await executor(next);
        memory.shift();
        flushed++;
      } catch (err) {
        next.attempts += 1;
        if (next.attempts >= MAX_ATTEMPTS) {
          // eslint-disable-next-line no-console
          console.warn('[offline-queue] dropping after max-attempts', { key: next.key, error: (err as Error)?.message });
          memory.shift();
          dropped++;
        } else {
          failed++;
        }
        break;
      }
    }
    await persist();
  } finally {
    flushInFlight = false;
  }
  return { flushed, failed, dropped };
};

/**
 * Install a NetInfo listener that auto-flushes when the device comes online.
 * Idempotent — safe to call multiple times.
 */
export const installOfflineFlushOnReconnect = (): void => {
  if (netUnsubscribe) return;
  netUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      void flush();
    }
  });
};

export const _resetForTests = (): void => {
  memory = [];
  loaded = false;
  if (netUnsubscribe) {
    netUnsubscribe();
    netUnsubscribe = null;
  }
};
