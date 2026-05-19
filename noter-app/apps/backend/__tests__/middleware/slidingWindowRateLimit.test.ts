import { checkSlidingWindow, _clearSlidingWindow, _getSnapshot } from '../../src/middleware/slidingWindowRateLimit';

beforeEach(() => _clearSlidingWindow());

describe('checkSlidingWindow', () => {
  it('allows requests under the limit', () => {
    const r1 = checkSlidingWindow('p', 'ip1', { points: 3, windowMs: 1000 }, 100);
    expect(r1.ok).toBe(true);
    const r2 = checkSlidingWindow('p', 'ip1', { points: 3, windowMs: 1000 }, 200);
    expect(r2.ok).toBe(true);
    const r3 = checkSlidingWindow('p', 'ip1', { points: 3, windowMs: 1000 }, 300);
    expect(r3.ok).toBe(true);
  });

  it('rejects the (limit+1)th request within the window', () => {
    checkSlidingWindow('p', 'ip2', { points: 2, windowMs: 1000 }, 100);
    checkSlidingWindow('p', 'ip2', { points: 2, windowMs: 1000 }, 200);
    const r = checkSlidingWindow('p', 'ip2', { points: 2, windowMs: 1000 }, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('honours the sliding window — old hits drop off', () => {
    checkSlidingWindow('p', 'ip3', { points: 2, windowMs: 1000 }, 100);
    checkSlidingWindow('p', 'ip3', { points: 2, windowMs: 1000 }, 200);
    // After 1100ms, the t=100 hit is outside the window.
    const r = checkSlidingWindow('p', 'ip3', { points: 2, windowMs: 1000 }, 1101);
    expect(r.ok).toBe(true);
  });

  it('separate prefixes have independent buckets', () => {
    checkSlidingWindow('pA', 'shared', { points: 1, windowMs: 1000 }, 100);
    const r = checkSlidingWindow('pB', 'shared', { points: 1, windowMs: 1000 }, 100);
    expect(r.ok).toBe(true);
  });

  it('separate keys within same prefix have independent buckets', () => {
    checkSlidingWindow('p', 'a', { points: 1, windowMs: 1000 }, 100);
    const r = checkSlidingWindow('p', 'b', { points: 1, windowMs: 1000 }, 100);
    expect(r.ok).toBe(true);
  });

  it('snapshot exposes the per-key hit timestamps', () => {
    checkSlidingWindow('p', 'k', { points: 5, windowMs: 5000 }, 100);
    checkSlidingWindow('p', 'k', { points: 5, windowMs: 5000 }, 200);
    expect(_getSnapshot('p', 'k')).toEqual([100, 200]);
  });

  it('retryAfter is non-negative even with clock edge cases', () => {
    checkSlidingWindow('p', 'edge', { points: 1, windowMs: 1000 }, 1000);
    const r = checkSlidingWindow('p', 'edge', { points: 1, windowMs: 1000 }, 1000);
    if (r.ok) throw new Error('expected rate limit');
    expect(r.retryAfterMs).toBeGreaterThanOrEqual(0);
  });
});
