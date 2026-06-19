import cache from '../../src/services/cache';

describe('cache service', () => {
  it('exposes a close() that is a safe no-op when never connected', async () => {
    // The client is created lazily and only connects on first get/set. Closing before any
    // connection must not throw or try to quit a non-open client — it just resolves.
    expect(typeof cache.close).toBe('function');
    await expect(cache.close()).resolves.toBeUndefined();
  });
});
