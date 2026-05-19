import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Routes we never log a body-size or URL component about because the URL
// itself can carry tokens or other secrets (e.g., /reset-password/<token>).
// We still log method/status/duration/requestId so SLOs work.
const SENSITIVE_URL_PREFIXES = [
  '/api/auth/reset-password',
  '/api/auth/verify',
  '/api/auth/refresh',
];

const isSensitiveUrl = (url: string): boolean =>
  SENSITIVE_URL_PREFIXES.some((p) => url.startsWith(p));

const sanitiseUrl = (url: string): string => {
  if (isSensitiveUrl(url)) {
    // Keep just the route prefix so we can still slice metrics by endpoint.
    const m = url.match(/^(\/api\/[^/?]+\/[^/?]+)/);
    return m ? `${m[1]}/<redacted>` : '<redacted>';
  }
  // Strip query string to avoid leaking tokens from misconfigured callers.
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
};

/**
 * Logs every completed request as a single structured line. Reads:
 *   - method, sanitised url, status, duration_ms
 *   - bytes_in (Content-Length when present), bytes_out
 *   - requestId from requestIdMiddleware
 *   - userId from authMiddleware when present (NOT email/etc.)
 *
 * Mount this AFTER requestIdMiddleware so we have the id, and AFTER
 * authMiddleware on routes that have it (we tolerate undefined).
 */
export const requestLogMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startNs = process.hrtime.bigint();
  let bytesOut = 0;

  // Cheap byte counter — tap into res.write/res.end.
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk) {
      bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as Response['write'];
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk) {
      bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return (origEnd as (...args: unknown[]) => Response)(chunk, ...rest);
  }) as Response['end'];

  res.on('finish', () => {
    const durMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
    const contentLen = req.headers['content-length'];
    const bytesIn = Array.isArray(contentLen) ? Number(contentLen[0]) : Number(contentLen);
    const payload = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      method: req.method,
      url: sanitiseUrl(req.originalUrl || req.url || ''),
      status: res.statusCode,
      duration_ms: durMs,
      bytes_in: Number.isFinite(bytesIn) ? bytesIn : 0,
      bytes_out: bytesOut,
      requestId: (req as Request & { requestId?: string }).requestId,
      userId: (req as Request & { user?: { userId?: string } }).user?.userId,
    };
    // Route through winston so transports/format apply.
    if (payload.level === 'error') logger.error('request', payload);
    else if (payload.level === 'warn') logger.warn('request', payload);
    else logger.info('request', payload);
  });

  next();
};

export { sanitiseUrl };
