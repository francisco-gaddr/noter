import {
  isTransientStatus,
  parseRetryAfterMs,
  computeBackoffMs,
  fetchWithRetry,
  TimeoutError,
  withTimeout,
} from './httpRetry';

type FakeResponse = { ok: boolean; status: number; headers: { get: (k: string) => string | null }; body?: { cancel?: () => void } };
const res = (status: number, retryAfter?: string): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
});

describe('isTransientStatus', () => {
  it('marks 408/429/5xx transient and 4xx (non-408/429) terminal', () => {
    expect(isTransientStatus(408)).toBe(true);
    expect(isTransientStatus(429)).toBe(true);
    expect([500, 502, 503, 504].every(isTransientStatus)).toBe(true);
    expect(isTransientStatus(200)).toBe(false);
    expect([400, 401, 403, 404].some(isTransientStatus)).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-06-19T00:00:00Z');
    expect(parseRetryAfterMs('Fri, 19 Jun 2026 00:00:10 GMT', now)).toBe(10_000);
    // A past date clamps to 0 (never negative).
    expect(parseRetryAfterMs('Fri, 19 Jun 2026 00:00:00 GMT', now + 5_000)).toBe(0);
  });
  it('returns null for absent/garbage values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('computeBackoffMs', () => {
  it('grows exponentially, applies equal jitter, and respects the cap', () => {
    expect(computeBackoffMs(0, { baseMs: 1000, capMs: 30_000, random: () => 0 })).toBe(500);
    expect(computeBackoffMs(0, { baseMs: 1000, capMs: 30_000, random: () => 1 })).toBe(1000);
    expect(computeBackoffMs(1, { baseMs: 1000, capMs: 30_000, random: () => 0 })).toBe(1000);
    expect(computeBackoffMs(1, { baseMs: 1000, capMs: 30_000, random: () => 1 })).toBe(2000);
    // capped: 1000 * 2^10 would be huge; cap=4000 → jitter range [2000,4000]
    expect(computeBackoffMs(10, { baseMs: 1000, capMs: 4000, random: () => 0 })).toBe(2000);
  });
});

describe('fetchWithRetry', () => {
  const instantSleep = jest.fn(async () => {});
  beforeEach(() => instantSleep.mockClear());

  it('returns immediately on a 2xx (no retry, no sleep)', async () => {
    const fetchImpl = jest.fn(async () => res(200)) as unknown as typeof fetch;
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep: instantSleep });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it('does NOT retry a non-transient 4xx (saves quota on a bad key)', async () => {
    const fetchImpl = jest.fn(async () => res(401)) as unknown as typeof fetch;
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep: instantSleep, maxRetries: 3 });
    expect(r.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it('retries a 429 honouring Retry-After, then succeeds', async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => (++n === 1 ? res(429, '2') : res(200))) as unknown as typeof fetch;
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep: instantSleep, maxRetries: 2 });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(instantSleep).toHaveBeenCalledWith(2000, undefined);
  });

  it('retries 5xx with backoff and gives up returning the last response', async () => {
    const fetchImpl = jest.fn(async () => res(503)) as unknown as typeof fetch;
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep: instantSleep, maxRetries: 2, random: () => 0 });
    expect(r.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(instantSleep).toHaveBeenCalledTimes(2);
  });

  it('retries a thrown network error then succeeds', async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => {
      if (++n <= 2) throw new Error('network down');
      return res(200);
    }) as unknown as typeof fetch;
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep: instantSleep, maxRetries: 2 });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws TimeoutError when an attempt exceeds the timeout', async () => {
    // fetch that hangs until its signal aborts (the internal timeout).
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    await expect(
      fetchWithRetry('u', {}, { fetchImpl, timeoutMs: 10, maxRetries: 0, sleep: instantSleep }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates a caller abort without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn(async () => res(200)) as unknown as typeof fetch;
    await expect(
      fetchWithRetry('u', {}, { fetchImpl, signal: controller.signal, sleep: instantSleep }),
    ).rejects.toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise wins the race', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with a TimeoutError when the deadline is hit first', async () => {
    const hang = new Promise<string>(() => { /* never settles */ });
    await expect(withTimeout(hang, 10)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('fires onTimeout so the caller can signal cooperative cancellation', async () => {
    let aborted = false;
    const hang = new Promise<string>(() => {});
    await expect(withTimeout(hang, 10, () => { aborted = true; })).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it('propagates the underlying rejection unchanged (not masked as a timeout)', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
