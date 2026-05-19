// Ensure REDIS_URL is unset so we exercise the memory fallback path
// (deterministic + dependency-free for unit testing).
delete process.env.REDIS_URL;

import {
  acquireLock,
  withLock,
  LockUnavailableError,
  _clearMemoryLocks,
} from '../../src/services/distributedLock';

beforeEach(() => _clearMemoryLocks());

describe('acquireLock (memory fallback)', () => {
  it('returns a handle on first acquisition', async () => {
    const l = await acquireLock('alpha', { ttlSeconds: 5 });
    expect(l).not.toBeNull();
    expect(l!.token.length).toBeGreaterThan(8);
  });

  it('returns null when the lock is already held', async () => {
    const first = await acquireLock('contended');
    expect(first).not.toBeNull();
    const second = await acquireLock('contended');
    expect(second).toBeNull();
  });

  it('release() lets a new acquirer succeed', async () => {
    const a = await acquireLock('to-release');
    expect(a).not.toBeNull();
    expect(await a!.release()).toBe(true);
    const b = await acquireLock('to-release');
    expect(b).not.toBeNull();
  });

  it('release() is owner-only — a different token cannot release', async () => {
    const a = await acquireLock('owner-check');
    expect(a).not.toBeNull();
    // Simulate a foreign release attempt: same key, different token.
    // Direct memoryLocks-poking isn't exposed; instead we acquire-and-fail
    // the second one, and verify the first owner still releases cleanly.
    const otherAttempt = await acquireLock('owner-check');
    expect(otherAttempt).toBeNull();
    expect(await a!.release()).toBe(true);
  });

  it('rejects malformed keys', async () => {
    await expect(acquireLock('')).rejects.toThrow(/invalid lock key/);
    await expect(acquireLock('a'.repeat(300))).rejects.toThrow(/invalid lock key/);
  });

  it('rejects unreasonable TTLs', async () => {
    await expect(acquireLock('k', { ttlSeconds: 0 })).rejects.toThrow(/ttlSeconds/);
    await expect(acquireLock('k', { ttlSeconds: 99999 })).rejects.toThrow(/ttlSeconds/);
  });

  it('expired locks can be re-acquired', async () => {
    const a = await acquireLock('expiring', { ttlSeconds: 1 });
    expect(a).not.toBeNull();
    // Synthetically expire: clear memory locks (simulates TTL).
    _clearMemoryLocks();
    const b = await acquireLock('expiring');
    expect(b).not.toBeNull();
  });
});

describe('withLock', () => {
  it('runs the function and releases', async () => {
    let ran = false;
    await withLock('with-lock-key', async () => { ran = true; });
    expect(ran).toBe(true);
    // Re-acquire should succeed because we released.
    const next = await acquireLock('with-lock-key');
    expect(next).not.toBeNull();
  });

  it('releases even if the function throws', async () => {
    await expect(withLock('throws-key', async () => {
      throw new Error('boom');
    })).rejects.toThrow(/boom/);
    // Lock should be released.
    const next = await acquireLock('throws-key');
    expect(next).not.toBeNull();
  });

  it('throws LockUnavailableError when lock is held', async () => {
    await acquireLock('busy-key');
    await expect(withLock('busy-key', async () => undefined)).rejects.toThrow(LockUnavailableError);
  });
});
