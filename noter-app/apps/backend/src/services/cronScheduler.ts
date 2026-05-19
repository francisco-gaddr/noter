import { withLock, LockUnavailableError } from './distributedLock';
import logger from '../utils/logger';

/**
 * Lightweight in-process cron-like scheduler.
 *
 * Why this and not node-cron / agenda:
 *   - We only need a tiny subset: "every 5 minutes", "every hour at :07",
 *     "at 03:00 daily". A 6-field cron expression is overkill and pulls
 *     in either a parser dep or a fragile hand-roll.
 *   - We DO want distributed-lock guarding (round 9) so multi-pod
 *     deployments don't fire the same job N times.
 *
 * Schedule shape (this module's own DSL):
 *   - `{ everyMs: 60000 }` — fixed interval (with jitter to spread load)
 *   - `{ everyHourAtMinute: 7 }` — once per hour at xx:07
 *   - `{ dailyAtUtc: '03:00' }` — once per day at the given UTC time
 *
 * Handler errors are caught and logged but never propagated — a job that
 * fails should not crash the scheduler loop. Job runs are wrapped in
 * `withLock` so only one pod runs each tick.
 */

type Schedule =
  | { kind: 'interval'; everyMs: number; jitterMs?: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; hourUtc: number; minuteUtc: number };

interface RegisteredJob {
  name: string;
  schedule: Schedule;
  handler: () => Promise<void>;
  lastRunAt: number;
  nextRunAt: number;
}

const MIN_INTERVAL_MS = 5_000;
const MAX_LOCK_TTL_SEC = 5 * 60;

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_:.\-]{0,63}$/;

const validateSchedule = (s: Schedule): void => {
  if (s.kind === 'interval') {
    if (!Number.isFinite(s.everyMs) || s.everyMs < MIN_INTERVAL_MS) {
      throw new Error(`interval must be >= ${MIN_INTERVAL_MS}ms`);
    }
    if (s.jitterMs !== undefined && (s.jitterMs < 0 || s.jitterMs > s.everyMs)) {
      throw new Error('jitterMs must be in [0, everyMs]');
    }
  } else if (s.kind === 'hourly') {
    if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) {
      throw new Error('hourly minute must be 0-59');
    }
  } else if (s.kind === 'daily') {
    if (!Number.isInteger(s.hourUtc) || s.hourUtc < 0 || s.hourUtc > 23) {
      throw new Error('daily hourUtc must be 0-23');
    }
    if (!Number.isInteger(s.minuteUtc) || s.minuteUtc < 0 || s.minuteUtc > 59) {
      throw new Error('daily minuteUtc must be 0-59');
    }
  }
};

/**
 * Compute the next run time given the schedule and a reference `from` time.
 * Pure — exposed for tests.
 */
export const computeNextRun = (schedule: Schedule, from: number): number => {
  if (schedule.kind === 'interval') {
    const jitter = schedule.jitterMs ? Math.floor(Math.random() * schedule.jitterMs) : 0;
    return from + schedule.everyMs + jitter;
  }
  if (schedule.kind === 'hourly') {
    const d = new Date(from);
    d.setUTCMilliseconds(0); d.setUTCSeconds(0);
    d.setUTCMinutes(schedule.minute);
    if (d.getTime() <= from) d.setUTCHours(d.getUTCHours() + 1);
    return d.getTime();
  }
  // daily
  const d = new Date(from);
  d.setUTCMilliseconds(0); d.setUTCSeconds(0);
  d.setUTCMinutes(schedule.minuteUtc);
  d.setUTCHours(schedule.hourUtc);
  if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
};

const jobs: RegisteredJob[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;

const scheduleTick = (): void => {
  if (timer) return;
  // Wake up on the soonest next-run, but never sleep longer than 30s so
  // jobs added mid-run get picked up promptly.
  const now = Date.now();
  let nextWake = now + 30_000;
  for (const job of jobs) {
    if (job.nextRunAt < nextWake) nextWake = job.nextRunAt;
  }
  const ms = Math.max(50, nextWake - now);
  timer = setTimeout(processDue, ms);
  timer.unref?.();
};

const processDue = async (): Promise<void> => {
  timer = null;
  if (!running) return;
  const now = Date.now();
  for (const job of jobs) {
    if (job.nextRunAt > now) continue;
    job.lastRunAt = now;
    job.nextRunAt = computeNextRun(job.schedule, now);
    void runOnce(job);
  }
  scheduleTick();
};

const runOnce = async (job: RegisteredJob): Promise<void> => {
  try {
    await withLock(`cron:${job.name}`, async () => {
      try {
        await job.handler();
      } catch (err) {
        logger.warn('cron.handler-failed', { name: job.name, error: (err as Error)?.message });
      }
    }, { ttlSeconds: MAX_LOCK_TTL_SEC });
  } catch (err) {
    if (err instanceof LockUnavailableError) {
      // Another pod won the race — that's the intended behaviour.
      return;
    }
    logger.warn('cron.lock-failed', { name: job.name, error: (err as Error)?.message });
  }
};

export const schedule = (name: string, sched: Schedule, handler: () => Promise<void>): void => {
  if (!NAME_PATTERN.test(name)) throw new Error('schedule name must match [a-zA-Z][a-zA-Z0-9_:.-]{0,63}');
  validateSchedule(sched);
  if (jobs.find((j) => j.name === name)) throw new Error(`schedule already registered: ${name}`);
  const now = Date.now();
  jobs.push({ name, schedule: sched, handler, lastRunAt: 0, nextRunAt: computeNextRun(sched, now) });
  if (running) scheduleTick();
};

export const start = (): void => {
  if (running) return;
  running = true;
  scheduleTick();
};

export const stop = async (): Promise<void> => {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
};

// Test helpers
export const _validateSchedule = validateSchedule;
export const _resetForTests = (): void => {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  jobs.length = 0;
};
export const _jobs = (): readonly RegisteredJob[] => jobs;
