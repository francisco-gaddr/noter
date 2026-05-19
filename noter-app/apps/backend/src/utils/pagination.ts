import { BadRequestError } from './httpErrors';

/**
 * Opaque cursor-based pagination.
 *
 * Why cursor vs offset:
 *   - Offset pagination (`?page=3&perPage=20`) returns inconsistent pages
 *     when items are inserted/deleted between calls — the user sees
 *     duplicates or misses notes.
 *   - Cursor pagination encodes the position of the last seen item, so the
 *     next page picks up exactly where the last one ended, even if new
 *     items were inserted at the top.
 *
 * Cursors are opaque base64url-encoded JSON `{ k: createdAt, i: _id }`.
 * We include `_id` as a tiebreaker for items with the same createdAt
 * (otherwise pagination silently skips ties).
 */

export interface PageCursor {
  /** Sort key value at the boundary — usually `createdAt` (ISO string or epoch). */
  k: string;
  /** Document `_id` tiebreaker. */
  i: string;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export const encodeCursor = (cursor: PageCursor): string => {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
};

export const decodeCursor = (raw: string | undefined): PageCursor | null => {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed && typeof parsed === 'object' &&
      typeof (parsed as PageCursor).k === 'string' &&
      typeof (parsed as PageCursor).i === 'string'
    ) {
      return parsed as PageCursor;
    }
    return null;
  } catch {
    return null;
  }
};

export interface ParsedPageParams {
  limit: number;
  cursor: PageCursor | null;
}

/**
 * Parse `?limit=&cursor=` from a query object. Throws BadRequestError on
 * invalid limit so the client gets a typed 400 rather than silently
 * getting unexpected results.
 */
export const parsePageParams = (query: Record<string, unknown>): ParsedPageParams => {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT) {
      throw new BadRequestError(`limit must be between 1 and ${MAX_LIMIT}`, {
        code: 'INVALID_LIMIT',
        details: { limit: query.limit, max: MAX_LIMIT },
      });
    }
    limit = Math.floor(n);
  }
  const cursorRaw = typeof query.cursor === 'string' ? query.cursor : undefined;
  const cursor = decodeCursor(cursorRaw);
  if (cursorRaw && !cursor) {
    throw new BadRequestError('invalid cursor', { code: 'INVALID_CURSOR' });
  }
  return { limit, cursor };
};

/**
 * Build a mongo filter slice for "items strictly after the cursor".
 * Used as `{ ...userFilter, ...buildCursorFilter(cursor, 'desc') }`.
 *
 * For descending sort (newest first): cursor's k > document's k → already seen.
 * For ascending: cursor's k < document's k → already seen.
 */
export const buildCursorFilter = (cursor: PageCursor | null, sortDirection: 'asc' | 'desc'): Record<string, unknown> => {
  if (!cursor) return {};
  const cmp = sortDirection === 'desc' ? '$lt' : '$gt';
  const tieCmp = sortDirection === 'desc' ? '$lt' : '$gt';
  return {
    $or: [
      { createdAt: { [cmp]: cursor.k } },
      { createdAt: cursor.k, _id: { [tieCmp]: cursor.i } },
    ],
  };
};

/**
 * Build a paginated response envelope. Caller fetches `limit+1` items, passes
 * them here, and gets a shape ready to JSON-serialise.
 */
export const buildPage = <T extends { _id: { toString(): string }; createdAt: string }>(
  items: T[],
  limit: number,
): { items: T[]; nextCursor: string | null; hasMore: boolean } => {
  const hasMore = items.length > limit;
  const slice = hasMore ? items.slice(0, limit) : items;
  const last = slice[slice.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ k: last.createdAt, i: last._id.toString() })
    : null;
  return { items: slice, nextCursor, hasMore };
};

export const _LIMITS = { MAX: MAX_LIMIT, DEFAULT: DEFAULT_LIMIT };
