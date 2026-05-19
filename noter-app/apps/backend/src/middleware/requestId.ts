import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      requestId?: string;
    }
  }
}

const HEADER_IN = ['x-request-id', 'x-correlation-id', 'request-id'];
const HEADER_OUT = 'X-Request-ID';
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const newId = (): string => randomBytes(8).toString('hex');

const pickInbound = (req: Request): string | undefined => {
  for (const h of HEADER_IN) {
    const v = req.headers[h];
    const candidate = Array.isArray(v) ? v[0] : v;
    if (typeof candidate === 'string' && ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * Adds `req.requestId` for downstream code, echoes the id in the
 * `X-Request-ID` response header, and validates inbound ids against a strict
 * allow-list pattern so an attacker cannot inject log-poisoning content.
 *
 * Mounted near the very top of the middleware chain so EVERY log line, perf
 * sample, and Server-Timing segment can be correlated.
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const id = pickInbound(req) ?? newId();
  req.requestId = id;
  res.setHeader(HEADER_OUT, id);
  next();
};

export const getRequestId = (req: Request): string | undefined => req.requestId;
