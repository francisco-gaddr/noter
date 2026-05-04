import { createSocketConnectionAttemptLimiter } from '../src/services/socketConnectionAttempts';

describe('createSocketConnectionAttemptLimiter', () => {
  it('rate limits in memory with window reset', async () => {
    const limiter = createSocketConnectionAttemptLimiter({ windowMs: 1000, max: 2 });

    await expect(limiter.check('ip-1', 0)).resolves.toMatchObject({ allowed: true, totalHits: 1, source: 'memory' });
    await expect(limiter.check('ip-1', 10)).resolves.toMatchObject({ allowed: true, totalHits: 2, source: 'memory' });
    await expect(limiter.check('ip-1', 20)).resolves.toMatchObject({ allowed: false, totalHits: 3, source: 'memory' });

    await expect(limiter.check('ip-1', 2000)).resolves.toMatchObject({ allowed: true, totalHits: 1, source: 'memory' });
  });

  it('rate limits via provided incrementer when available', async () => {
    let hits = 0;
    const limiter = createSocketConnectionAttemptLimiter({
      windowMs: 1000,
      max: 2,
      increment: async () => ({ totalHits: (hits += 1) }),
    });

    await expect(limiter.check('ip-2', 0)).resolves.toMatchObject({ allowed: true, totalHits: 1, source: 'redis' });
    await expect(limiter.check('ip-2', 0)).resolves.toMatchObject({ allowed: true, totalHits: 2, source: 'redis' });
    await expect(limiter.check('ip-2', 0)).resolves.toMatchObject({ allowed: false, totalHits: 3, source: 'redis' });
  });

  it('falls back to memory when incrementer throws', async () => {
    const limiter = createSocketConnectionAttemptLimiter({
      windowMs: 1000,
      max: 1,
      increment: async () => {
        throw new Error('redis down');
      },
    });

    await expect(limiter.check('ip-3', 0)).resolves.toMatchObject({ allowed: true, totalHits: 1, source: 'memory' });
    await expect(limiter.check('ip-3', 10)).resolves.toMatchObject({ allowed: false, totalHits: 2, source: 'memory' });
  });
});

