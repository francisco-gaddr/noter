import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Replace non-finite numeric values (`NaN`, `Infinity`, `-Infinity`) in
 * `req.body` / `req.query` with `null`, recursively.
 *
 * Why this exists:
 *   - `JSON.parse` doesn't accept these literally, but a custom reviver
 *     plus libraries (msgpack, BSON-EJSON) and clients that pre-construct
 *     query strings can sneak them through.
 *   - mongoose silently writes `NaN` to numeric fields, and a `NaN` in an
 *     indexed field causes confusing query behaviour ("WHERE x = NaN"
 *     never matches anything, not even other NaNs).
 *   - The audit log + structured request log treat `NaN` as a string and
 *     produce malformed JSON in some downstream tools.
 *
 * Strategy: walk the value tree once per request. For arrays/objects,
 * descend; for numbers, check `Number.isFinite`. Sanitised values are
 * logged at info level with the path so we can spot bad clients.
 */

const MAX_DEPTH = 6;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
};

interface SanitiseResult {
  value: unknown;
  paths: string[];
}

export const sanitiseValue = (input: unknown, depth = 0, path: string = ''): SanitiseResult => {
  if (depth > MAX_DEPTH) return { value: input, paths: [] };
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { value: null, paths: [path || '<root>'] };
    }
    return { value: input, paths: [] };
  }
  if (Array.isArray(input)) {
    const out: unknown[] = [];
    const paths: string[] = [];
    for (let i = 0; i < input.length; i++) {
      const child = sanitiseValue(input[i], depth + 1, `${path}[${i}]`);
      out.push(child.value);
      paths.push(...child.paths);
    }
    return { value: out, paths };
  }
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    const paths: string[] = [];
    for (const [k, v] of Object.entries(input)) {
      const child = sanitiseValue(v, depth + 1, path ? `${path}.${k}` : k);
      out[k] = child.value;
      paths.push(...child.paths);
    }
    return { value: out, paths };
  }
  return { value: input, paths: [] };
};

/**
 * Express middleware. Mount AFTER express.json (so req.body is parsed)
 * but before route handlers. Cheap: a no-op when the body has no
 * non-finite numbers — most requests.
 */
export const sanitiseNumbersMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') {
    const result = sanitiseValue(req.body);
    if (result.paths.length > 0) {
      req.body = result.value as typeof req.body;
      logger.info('request.sanitised-non-finite', {
        requestId: (req as Request & { requestId?: string }).requestId,
        paths: result.paths.slice(0, 10),
      });
    }
  }
  if (req.query && typeof req.query === 'object') {
    // query values are usually strings via express; we sanitise anyway
    // in case a parser converted them to numbers. We assign through
    // `unknown` because express's ParsedQs typing is strict about its
    // value shape and our sanitiser preserves it for valid inputs.
    const result = sanitiseValue(req.query);
    if (result.paths.length > 0) {
      (req as unknown as { query: unknown }).query = result.value;
    }
  }
  next();
};
