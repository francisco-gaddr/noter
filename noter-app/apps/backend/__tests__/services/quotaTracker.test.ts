import { _periodFor, _bucketKey } from '../../src/services/quotaTracker';

describe('quotaTracker periodFor', () => {
  const fixed = new Date('2026-05-19T14:32:11Z');

  it('emits hour bucket', () => {
    expect(_periodFor('hour', fixed)).toBe('2026-05-19T14');
  });

  it('emits day bucket', () => {
    expect(_periodFor('day', fixed)).toBe('2026-05-19');
  });

  it('emits month bucket', () => {
    expect(_periodFor('month', fixed)).toBe('2026-05');
  });

  it('zero-pads month/day/hour', () => {
    expect(_periodFor('hour', new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03');
  });

  it('respects UTC (no timezone drift)', () => {
    // Around midnight UTC the local day differs depending on host TZ;
    // we always emit UTC so buckets are deterministic.
    const utc = new Date('2026-05-19T23:59:59Z');
    expect(_periodFor('day', utc)).toBe('2026-05-19');
  });
});

describe('quotaTracker bucketKey', () => {
  it('combines key + period bucket', () => {
    const now = new Date('2026-05-19T14:00:00Z');
    expect(_bucketKey('ai', 'day', now)).toBe('ai:2026-05-19');
    expect(_bucketKey('sync', 'month', now)).toBe('sync:2026-05');
  });

  it('handles short keys', () => {
    expect(_bucketKey('x', 'hour', new Date('2026-01-01T00:00:00Z'))).toBe('x:2026-01-01T00');
  });
});
