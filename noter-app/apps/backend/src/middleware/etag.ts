import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';

const computeWeakEtag = (payload: string | Buffer): string => {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  // Weak validator (W/) — we don't promise byte-for-byte identity (e.g. JSON
  // key ordering, whitespace). FNV would be faster but the cost of sha1
  // on a sub-100kb JSON response is negligible compared to the network save.
  const hash = createHash('sha1').update(buf).digest('base64url');
  return `W/"${hash}"`;
};

const matchesIfNoneMatch = (etag: string, ifNoneMatch: string | undefined): boolean => {
  if (!ifNoneMatch) return false;
  // Support comma-separated list per RFC 9110 §13.1.2
  const entries = ifNoneMatch.split(',').map((s) => s.trim());
  return entries.includes(etag) || entries.includes('*');
};

export interface EtagOptions {
  /** Only attach to these methods (default: GET, HEAD). */
  methods?: string[];
  /** Cache-Control header to set on the response (default: 'private, max-age=0, must-revalidate'). */
  cacheControl?: string;
}

/**
 * Express middleware that adds weak ETag + Cache-Control to JSON responses.
 *
 * Sends `304 Not Modified` (with no body) when the client's If-None-Match
 * header matches our computed ETag — saves bandwidth on note-list polling
 * while keeping every list immediately fresh after a write (write paths
 * naturally produce new content → new ETag → 200).
 *
 * Mounted per-route rather than globally because mutations + GraphQL don't
 * benefit and the hash overhead is wasted on them.
 */
export const conditionalGet = (opts: EtagOptions = {}) => {
  const methods = new Set(opts.methods ?? ['GET', 'HEAD']);
  const cacheControl = opts.cacheControl ?? 'private, max-age=0, must-revalidate';

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!methods.has(req.method)) return next();

    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        // Don't ETag error responses; clients revalidating against a 5xx ETag
        // would never bust on retry.
        if (res.statusCode >= 400) return origJson(body);
        const serialized = JSON.stringify(body);
        const etag = computeWeakEtag(serialized);
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', cacheControl);
        const ifNoneMatch = req.headers['if-none-match'];
        const inm = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
        if (matchesIfNoneMatch(etag, inm)) {
          res.status(304);
          // 304 MUST NOT have a body; setHeader is fine but body must be empty.
          return res.end();
        }
        return origJson(body);
      } catch {
        return origJson(body);
      }
    }) as Response['json'];

    next();
  };
};

export { computeWeakEtag, matchesIfNoneMatch };
