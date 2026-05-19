import {
  encodeCursor,
  decodeCursor,
  parsePageParams,
  buildCursorFilter,
  buildPage,
  _LIMITS,
} from '../../src/utils/pagination';
import { BadRequestError } from '../../src/utils/httpErrors';

describe('encode/decodeCursor round-trip', () => {
  it('round-trips an arbitrary cursor', () => {
    const c = { k: '2026-05-19T12:34:56Z', i: '507f1f77bcf86cd799439011' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('returns null for malformed cursor strings', () => {
    expect(decodeCursor('not-base64!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null when payload is not the expected shape', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeCursor(wrongShape)).toBeNull();
  });
});

describe('parsePageParams', () => {
  it('returns defaults when no query params', () => {
    expect(parsePageParams({})).toEqual({ limit: _LIMITS.DEFAULT, cursor: null });
  });

  it('honours limit param', () => {
    expect(parsePageParams({ limit: '50' }).limit).toBe(50);
  });

  it('rejects limit > MAX', () => {
    expect(() => parsePageParams({ limit: '999' })).toThrow(BadRequestError);
  });

  it('rejects limit < 1', () => {
    expect(() => parsePageParams({ limit: '0' })).toThrow(BadRequestError);
  });

  it('rejects non-numeric limit', () => {
    expect(() => parsePageParams({ limit: 'abc' })).toThrow(BadRequestError);
  });

  it('parses cursor', () => {
    const c = encodeCursor({ k: '2026-01-01', i: 'abc' });
    expect(parsePageParams({ cursor: c }).cursor).toEqual({ k: '2026-01-01', i: 'abc' });
  });

  it('throws BadRequest on malformed cursor', () => {
    expect(() => parsePageParams({ cursor: 'totally-not-a-cursor!' })).toThrow(BadRequestError);
  });

  it('floors limit', () => {
    expect(parsePageParams({ limit: '42.7' }).limit).toBe(42);
  });
});

describe('buildCursorFilter', () => {
  it('returns empty filter for null cursor', () => {
    expect(buildCursorFilter(null, 'desc')).toEqual({});
  });

  it('builds $lt filter for desc sort', () => {
    const filter = buildCursorFilter({ k: '2026', i: 'a' }, 'desc');
    expect(filter).toEqual({
      $or: [
        { createdAt: { $lt: '2026' } },
        { createdAt: '2026', _id: { $lt: 'a' } },
      ],
    });
  });

  it('builds $gt filter for asc sort', () => {
    const filter = buildCursorFilter({ k: '2026', i: 'a' }, 'asc');
    expect(filter).toEqual({
      $or: [
        { createdAt: { $gt: '2026' } },
        { createdAt: '2026', _id: { $gt: 'a' } },
      ],
    });
  });
});

describe('buildPage', () => {
  const item = (id: string, createdAt: string) => ({ _id: { toString: () => id }, createdAt });

  it('returns hasMore=false when items.length <= limit', () => {
    const page = buildPage([item('a', '2026'), item('b', '2025')], 5);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(2);
  });

  it('returns hasMore=true and nextCursor when items.length > limit', () => {
    const items = [item('a', '2026'), item('b', '2025'), item('c', '2024')];
    const page = buildPage(items, 2);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const decoded = decodeCursor(page.nextCursor!);
    // Last visible item's createdAt + id
    expect(decoded).toEqual({ k: '2025', i: 'b' });
  });
});
