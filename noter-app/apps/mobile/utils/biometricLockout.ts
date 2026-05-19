/**
 * Pure helpers for the sliding-window biometric lockout logic used by
 * `components/AppLock.tsx`. Extracted so the rate-limit semantics can
 * be unit-tested without an RN runtime.
 *
 * Behaviour:
 *   - `MAX_ATTEMPTS` failures inside `WINDOW_MS` trigger a `LOCKOUT_MS`
 *     cool-down where new unlock prompts are refused.
 *   - Successful unlock clears the counter immediately.
 *   - Old attempts outside the sliding window are evicted on every check.
 *
 * The counter state lives in a caller-owned array of timestamps (ms);
 * these helpers are pure functions over that array + the wall clock.
 */

export const MAX_BIOMETRIC_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 60_000;
export const LOCKOUT_DURATION_MS = 30_000;

export const pruneExpiredAttempts = (
  attempts: readonly number[],
  now: number,
  windowMs: number = ATTEMPT_WINDOW_MS,
): number[] => attempts.filter((t) => now - t < windowMs);

export const recordFailure = (
  attempts: readonly number[],
  now: number,
  windowMs: number = ATTEMPT_WINDOW_MS,
): { nextAttempts: number[]; lockoutUntil: number | null } => {
  const pruned = pruneExpiredAttempts(attempts, now, windowMs);
  pruned.push(now);
  if (pruned.length >= MAX_BIOMETRIC_ATTEMPTS) {
    return { nextAttempts: pruned, lockoutUntil: now + LOCKOUT_DURATION_MS };
  }
  return { nextAttempts: pruned, lockoutUntil: null };
};

export const isLockedOut = (lockoutUntilMs: number, now: number): boolean => lockoutUntilMs > now;

export const lockoutSecondsRemaining = (lockoutUntilMs: number, now: number): number => {
  if (lockoutUntilMs <= now) return 0;
  return Math.max(1, Math.ceil((lockoutUntilMs - now) / 1000));
};
