import { randomBytes } from 'node:crypto';
import logger from '../utils/logger';

/**
 * In-process background job queue.
 *
 * Why not a real queue (BullMQ etc.): for the common case of "send a
 * webhook", "expire some cached thing", "recompute a counter", a heavy
 * dependency-tree is overkill. A single-process FIFO with retries
 * handles 99% of the work load.
 *
 * Single-pod by design. For multi-pod fan-out, the Redis-backed
 * distributed lock from round 9 + a periodic poll on the Mongo collection
 * is the natural escalation path.
 *
 * Public API:
 *   - register(name, handler) — define a job type
 *   - enqueue(name, payload, opts?) — schedule one
 *   - drain() — return a promise that resolves when queue empties
 *   - close() — stop accepting new jobs and wait for in-flight to drain
 *
 * Each job has a stable id; handlers receive `(payload, jobId, attempt)`.
 * Retries use exponential backoff (jittered).
 */

export type JobHandler<P = unknown> = (payload: P, jobId: string, attempt: number) => Promise<void>;

export interface EnqueueOptions {
  /** Max retry attempts (default 3). */
  maxAttempts?: number;
  /** Initial delay before first run (ms). */
  delayMs?: number;
}

interface Job {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAfter: number; // unix ms
}

const handlers = new Map<string, JobHandler<unknown>>();
const queue: Job[] = [];
const inflight = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let closing = false;
let drainResolvers: Array<() => void> = [];

const MAX_CONCURRENCY = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const TICK_MS = 50;

const newJobId = (): string => randomBytes(8).toString('hex');

const computeBackoff = (attempt: number): number => {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter so retries from a batch failure don't all land at once.
  return Math.floor(Math.random() * exp);
};

const scheduleTick = (): void => {
  if (timer || closing) return;
  timer = setTimeout(processNext, TICK_MS);
  timer.unref?.();
};

const settleDrainers = (): void => {
  if (queue.length === 0 && inflight.size === 0 && drainResolvers.length > 0) {
    const resolvers = drainResolvers;
    drainResolvers = [];
    for (const r of resolvers) r();
  }
};

const runJob = async (job: Job): Promise<void> => {
  const handler = handlers.get(job.name);
  if (!handler) {
    logger.warn('jobQueue: no handler registered, dropping', { name: job.name, jobId: job.id });
    return;
  }
  inflight.add(job.id);
  job.attempts += 1;
  try {
    await handler(job.payload, job.id, job.attempts);
  } catch (err) {
    if (job.attempts < job.maxAttempts) {
      job.runAfter = Date.now() + computeBackoff(job.attempts);
      logger.warn('jobQueue: job failed, scheduling retry', {
        name: job.name, jobId: job.id, attempt: job.attempts, error: (err as Error)?.message,
      });
      queue.push(job);
    } else {
      logger.error('jobQueue: job exhausted retries, dropping', {
        name: job.name, jobId: job.id, attempts: job.attempts, error: (err as Error)?.message,
      });
    }
  } finally {
    inflight.delete(job.id);
    settleDrainers();
    scheduleTick();
  }
};

const processNext = (): void => {
  timer = null;
  if (closing && queue.length === 0 && inflight.size === 0) {
    settleDrainers();
    return;
  }
  const now = Date.now();
  while (inflight.size < MAX_CONCURRENCY) {
    const idx = queue.findIndex((j) => j.runAfter <= now);
    if (idx === -1) break;
    const [job] = queue.splice(idx, 1);
    void runJob(job);
  }
  if (queue.length > 0 || inflight.size > 0) scheduleTick();
  else settleDrainers();
};

export const register = <P>(name: string, handler: JobHandler<P>): void => {
  if (!/^[a-zA-Z][a-zA-Z0-9_:.\-]{0,63}$/.test(name)) {
    throw new Error('job name must match [a-zA-Z][a-zA-Z0-9_:.-]{0,63}');
  }
  handlers.set(name, handler as JobHandler<unknown>);
};

export const enqueue = <P>(name: string, payload: P, opts: EnqueueOptions = {}): string => {
  if (closing) throw new Error('jobQueue is closing');
  if (!handlers.has(name)) throw new Error(`no handler registered for job '${name}'`);
  const job: Job = {
    id: newJobId(),
    name,
    payload,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    runAfter: Date.now() + (opts.delayMs ?? 0),
  };
  queue.push(job);
  scheduleTick();
  return job.id;
};

export const drain = (): Promise<void> => {
  if (queue.length === 0 && inflight.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => { drainResolvers.push(resolve); });
};

export const close = async (): Promise<void> => {
  closing = true;
  await drain();
};

export const _size = (): number => queue.length;
export const _inFlight = (): number => inflight.size;
export const _resetForTests = (): void => {
  closing = false;
  if (timer) clearTimeout(timer);
  timer = null;
  queue.length = 0;
  inflight.clear();
  handlers.clear();
  drainResolvers = [];
};
