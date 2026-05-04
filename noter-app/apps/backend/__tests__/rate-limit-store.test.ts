describe('createRedisRateLimitStore', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
  });

  it('returns undefined when REDIS_URL is not configured', () => {
    const { createRedisRateLimitStore } = require('../src/services/rateLimitStore');
    expect(createRedisRateLimitStore('rl:test')).toBeUndefined();
  });

  it('increments keys and sets resetTime based on TTL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    process.env.REDIS_URL = 'redis://localhost:6379';

    const mockClient: any = {
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn(),
      pTTL: jest.fn().mockResolvedValue(15_000),
      incr: jest.fn().mockResolvedValue(1),
      pExpire: jest.fn().mockResolvedValue(true),
      decr: jest.fn(),
      del: jest.fn(),
      quit: jest.fn(),
    };

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => mockClient),
    }));

    const { createRedisRateLimitStore } = require('../src/services/rateLimitStore');
    const store = createRedisRateLimitStore('rl:test');
    expect(store).toBeTruthy();

    store.init({ windowMs: 15_000 } as any);

    const result = await store.increment('ip:1');
    expect(mockClient.incr).toHaveBeenCalledWith('rl:test:ip:1');
    expect(mockClient.pExpire).toHaveBeenCalledWith('rl:test:ip:1', 15_000);
    expect(result.totalHits).toBe(1);
    expect(result.resetTime?.toISOString()).toBe('2026-01-01T00:00:15.000Z');

    jest.useRealTimers();
  });

  it('get returns undefined when key is missing', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    process.env.REDIS_URL = 'redis://localhost:6379';

    const mockClient: any = {
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      pTTL: jest.fn().mockResolvedValue(-2),
      incr: jest.fn(),
      pExpire: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
      quit: jest.fn(),
    };

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => mockClient),
    }));

    const { createRedisRateLimitStore } = require('../src/services/rateLimitStore');
    const store = createRedisRateLimitStore('rl:test');
    store.init({ windowMs: 15_000 } as any);

    const result = await store.get('ip:missing');
    expect(mockClient.get).toHaveBeenCalledWith('rl:test:ip:missing');
    expect(result).toBeUndefined();

    jest.useRealTimers();
  });
});

