import { chunk, _isRetryableError, _computeBackoff, _DEFAULT_BATCH_SIZE, _MAX_BATCH_SIZE } from '../../src/utils/bulkWrite';

describe('chunk', () => {
  it('splits an array into fixed-size chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns empty for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('throws on invalid size', () => {
    expect(() => chunk([1, 2], 0)).toThrow(/size/);
  });

  it('handles a single chunk', () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });
});

describe('isRetryableError', () => {
  it('detects mongo "NotMaster" codeName', () => {
    expect(_isRetryableError({ codeName: 'NotMaster' })).toBe(true);
    expect(_isRetryableError({ codeName: 'PrimarySteppedDown' })).toBe(true);
  });

  it('detects mongo InterruptedAtShutdown', () => {
    expect(_isRetryableError({ codeName: 'InterruptedAtShutdown' })).toBe(true);
  });

  it('detects network errors by name', () => {
    expect(_isRetryableError({ name: 'MongoNetworkError' })).toBe(true);
    expect(_isRetryableError({ name: 'MongoNetworkTimeoutError' })).toBe(true);
  });

  it('detects retryable error codes', () => {
    expect(_isRetryableError({ code: 11600 })).toBe(true);
    expect(_isRetryableError({ code: 13435 })).toBe(true);
  });

  it('rejects validation / permission errors', () => {
    expect(_isRetryableError({ code: 121, codeName: 'DocumentValidationFailure' })).toBe(false);
    expect(_isRetryableError({ code: 13, codeName: 'Unauthorized' })).toBe(false);
  });

  it('rejects unknown errors safely', () => {
    expect(_isRetryableError({})).toBe(false);
    expect(_isRetryableError(null)).toBe(false);
  });
});

describe('computeBackoff', () => {
  it('caps at 5000ms', () => {
    for (let i = 0; i < 50; i++) {
      expect(_computeBackoff(20)).toBeLessThanOrEqual(5000);
    }
  });

  it('produces values in [0, base * 2^attempt]', () => {
    for (let i = 0; i < 50; i++) {
      expect(_computeBackoff(0)).toBeLessThanOrEqual(200);
      expect(_computeBackoff(2)).toBeLessThanOrEqual(800);
    }
  });
});

describe('limits', () => {
  it('exports sensible defaults', () => {
    expect(_DEFAULT_BATCH_SIZE).toBe(500);
    expect(_MAX_BATCH_SIZE).toBe(1000);
  });
});
