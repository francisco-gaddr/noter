import { computeNextRun, _validateSchedule, _withHandlerTimeout } from '../../src/services/cronScheduler';

describe('computeNextRun — interval', () => {
  it('returns from + everyMs (deterministic when no jitter)', () => {
    expect(computeNextRun({ kind: 'interval', everyMs: 60_000 }, 1_000_000)).toBe(1_060_000);
  });

  it('jitter widens the result but never exceeds everyMs+jitterMs', () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(computeNextRun({ kind: 'interval', everyMs: 1000, jitterMs: 500 }, 0));
    }
    // Range expected: [1000, 1500). Probabilistic — assert bounds.
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(1000);
      expect(r).toBeLessThan(1500);
    }
  });
});

describe('computeNextRun — hourly', () => {
  it('picks the next xx:07 after the given time', () => {
    const ts = new Date('2026-05-19T14:00:00Z').getTime();
    const next = computeNextRun({ kind: 'hourly', minute: 7 }, ts);
    expect(new Date(next).toISOString()).toBe('2026-05-19T14:07:00.000Z');
  });

  it('rolls to the next hour if minute has passed', () => {
    const ts = new Date('2026-05-19T14:10:00Z').getTime();
    const next = computeNextRun({ kind: 'hourly', minute: 7 }, ts);
    expect(new Date(next).toISOString()).toBe('2026-05-19T15:07:00.000Z');
  });
});

describe('computeNextRun — daily', () => {
  it('picks the next 03:00 UTC', () => {
    const ts = new Date('2026-05-19T01:00:00Z').getTime();
    const next = computeNextRun({ kind: 'daily', hourUtc: 3, minuteUtc: 0 }, ts);
    expect(new Date(next).toISOString()).toBe('2026-05-19T03:00:00.000Z');
  });

  it('rolls to tomorrow if today has passed', () => {
    const ts = new Date('2026-05-19T04:00:00Z').getTime();
    const next = computeNextRun({ kind: 'daily', hourUtc: 3, minuteUtc: 0 }, ts);
    expect(new Date(next).toISOString()).toBe('2026-05-20T03:00:00.000Z');
  });
});

describe('_validateSchedule', () => {
  it('rejects too-short intervals', () => {
    expect(() => _validateSchedule({ kind: 'interval', everyMs: 100 })).toThrow(/interval/);
  });

  it('rejects out-of-range hour/minute', () => {
    expect(() => _validateSchedule({ kind: 'daily', hourUtc: 25, minuteUtc: 0 })).toThrow();
    expect(() => _validateSchedule({ kind: 'hourly', minute: 60 })).toThrow();
  });

  it('accepts valid schedules', () => {
    expect(() => _validateSchedule({ kind: 'interval', everyMs: 60_000 })).not.toThrow();
    expect(() => _validateSchedule({ kind: 'hourly', minute: 30 })).not.toThrow();
    expect(() => _validateSchedule({ kind: 'daily', hourUtc: 12, minuteUtc: 0 })).not.toThrow();
  });

  it('rejects jitter > everyMs', () => {
    expect(() => _validateSchedule({ kind: 'interval', everyMs: 1000, jitterMs: 2000 })).toThrow();
  });
});

describe('_withHandlerTimeout', () => {
  it('resolves with the handler value when it settles in time', async () => {
    await expect(_withHandlerTimeout(Promise.resolve(42), 1000, 'nope')).resolves.toBe(42);
  });

  it('propagates a handler rejection unchanged (not as a timeout)', async () => {
    await expect(_withHandlerTimeout(Promise.reject(new Error('boom')), 1000, 'timeout')).rejects.toThrow('boom');
  });

  it('rejects with the label when the handler exceeds the timeout', async () => {
    jest.useFakeTimers();
    try {
      const never = new Promise<void>(() => {}); // never settles
      const p = _withHandlerTimeout(never, 1000, "cron handler 'x' timed out");
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await jest.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
