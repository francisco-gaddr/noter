import { computeRetryDelay, isRetryableStatus, isNetworkErrorMessage } from '../../services/retry';

describe('computeRetryDelay', () => {
  it('honours Retry-After (seconds)', () => {
    expect(computeRetryDelay(0, '3')).toBe(3000);
  });

  it('caps Retry-After at maxDelayMs', () => {
    expect(computeRetryDelay(0, '999', { maxDelayMs: 5000 })).toBe(5000);
  });

  it('honours Retry-After (HTTP-date)', () => {
    const now = Date.now();
    // UTCString has 1-second granularity so the parsed-back ms can be up to
    // 999ms earlier than the source. Widen slack accordingly.
    const futureDate = new Date(now + 2000).toUTCString();
    const delay = computeRetryDelay(0, futureDate, { now: () => now });
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it('ignores past Retry-After dates and uses jitter instead', () => {
    const now = Date.now();
    const pastDate = new Date(now - 5000).toUTCString();
    const delay = computeRetryDelay(0, pastDate, { now: () => now, random: () => 0.5 });
    // Full jitter at attempt 0 with random=0.5 → 0.5 * 500 = 250
    expect(delay).toBe(250);
  });

  it('uses full-jitter exponential backoff when no Retry-After', () => {
    expect(computeRetryDelay(0, null, { random: () => 0.5 })).toBe(250);  // 500 * 1 * 0.5
    expect(computeRetryDelay(1, null, { random: () => 0.5 })).toBe(500);  // 500 * 2 * 0.5
    expect(computeRetryDelay(2, null, { random: () => 0.5 })).toBe(1000); // 500 * 4 * 0.5
    expect(computeRetryDelay(3, null, { random: () => 0.5 })).toBe(2000); // 500 * 8 * 0.5
  });

  it('caps exponential backoff at maxDelayMs', () => {
    // attempt 10 → 500 * 1024 = 512000, capped to 8000, * 0.5 = 4000
    expect(computeRetryDelay(10, null, { random: () => 0.5 })).toBe(4000);
  });

  it('returns 0 when random=0 (full jitter floor)', () => {
    expect(computeRetryDelay(3, null, { random: () => 0 })).toBe(0);
  });

  it('handles malformed Retry-After by falling back to jitter', () => {
    expect(computeRetryDelay(0, 'not-a-thing', { random: () => 0.5 })).toBe(250);
  });
});

describe('isRetryableStatus', () => {
  it.each([500, 502, 503, 504, 429])('retries %d', (s) => {
    expect(isRetryableStatus(s)).toBe(true);
  });
  it.each([400, 401, 403, 404, 422])('does not retry %d', (s) => {
    expect(isRetryableStatus(s)).toBe(false);
  });
});

describe('isNetworkErrorMessage', () => {
  it('classifies known fetch-failure messages', () => {
    expect(isNetworkErrorMessage('Network request failed')).toBe(true);
    expect(isNetworkErrorMessage('A network error occurred')).toBe(true);
    expect(isNetworkErrorMessage('Failed to fetch resource')).toBe(true);
  });

  it('does not classify generic errors', () => {
    expect(isNetworkErrorMessage('Unauthorized')).toBe(false);
    expect(isNetworkErrorMessage('Internal Server Error')).toBe(false);
  });
});
