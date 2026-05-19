import {
  pruneExpiredAttempts,
  recordFailure,
  isLockedOut,
  lockoutSecondsRemaining,
  MAX_BIOMETRIC_ATTEMPTS,
  ATTEMPT_WINDOW_MS,
  LOCKOUT_DURATION_MS,
} from '../../utils/biometricLockout';

describe('biometricLockout — pruneExpiredAttempts', () => {
  it('keeps attempts inside the window', () => {
    expect(pruneExpiredAttempts([100, 200, 300], 350, 1000)).toEqual([100, 200, 300]);
  });

  it('evicts attempts outside the window', () => {
    expect(pruneExpiredAttempts([100, 200, 300], 1150, 1000)).toEqual([200, 300]);
  });

  it('returns empty array when all attempts have expired', () => {
    expect(pruneExpiredAttempts([100, 200], 5000, 1000)).toEqual([]);
  });
});

describe('biometricLockout — recordFailure', () => {
  it('first failure: no lockout', () => {
    const r = recordFailure([], 1000);
    expect(r.lockoutUntil).toBeNull();
    expect(r.nextAttempts).toEqual([1000]);
  });

  it('triggers lockout exactly at MAX_BIOMETRIC_ATTEMPTS', () => {
    const attempts = [100, 200, 300, 400];
    const r = recordFailure(attempts, 500);
    expect(r.nextAttempts).toHaveLength(MAX_BIOMETRIC_ATTEMPTS);
    expect(r.lockoutUntil).toBe(500 + LOCKOUT_DURATION_MS);
  });

  it('does not trigger lockout one short of the limit', () => {
    const attempts = [100, 200, 300];
    const r = recordFailure(attempts, 400);
    expect(r.lockoutUntil).toBeNull();
  });

  it('window prunes during recordFailure (old attempts do not count)', () => {
    // Attempts older than the full window get evicted; we don't lock out on
    // a single new failure following a quiet hour. The last entry (300) is
    // still inside the window after a `ATTEMPT_WINDOW_MS + 1` skip, so the
    // worth-keeping check uses `300 + ATTEMPT_WINDOW_MS + 1` instead so
    // every prior attempt is genuinely outside.
    const attempts = [100, 200, 300];
    const r = recordFailure(attempts, 300 + ATTEMPT_WINDOW_MS + 1);
    expect(r.lockoutUntil).toBeNull();
    expect(r.nextAttempts).toHaveLength(1);
  });
});

describe('biometricLockout — isLockedOut', () => {
  it('true while lockout future', () => {
    expect(isLockedOut(2000, 1000)).toBe(true);
  });

  it('false when lockout expired', () => {
    expect(isLockedOut(1000, 1500)).toBe(false);
  });

  it('false when never locked (lockoutUntilMs = 0)', () => {
    expect(isLockedOut(0, 1000)).toBe(false);
  });
});

describe('biometricLockout — lockoutSecondsRemaining', () => {
  it('zero when not locked', () => {
    expect(lockoutSecondsRemaining(0, 1000)).toBe(0);
    expect(lockoutSecondsRemaining(500, 1000)).toBe(0);
  });

  it('rounds up so we never show "0s remaining" while still locked', () => {
    expect(lockoutSecondsRemaining(1500, 1000)).toBeGreaterThanOrEqual(1);
  });

  it('reports correct seconds for a future lockout', () => {
    expect(lockoutSecondsRemaining(30_000, 0)).toBe(30);
    expect(lockoutSecondsRemaining(30_000, 25_000)).toBe(5);
  });
});
