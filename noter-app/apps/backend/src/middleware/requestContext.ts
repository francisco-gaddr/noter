import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './authMiddleware';
import type winston from 'winston';

export const createRequestContextMiddleware = (baseLogger: winston.Logger) => (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const requestIdHeader = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined;
  const requestId = requestIdHeader?.trim() || randomUUID();
  req.requestId = requestId;
  req.log = baseLogger.child({ requestId });
  res.setHeader('X-Request-Id', requestId);
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.userId;
    const requestLogger = req.log || baseLogger;
    requestLogger.info('HTTP request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ...(userId ? { userId } : {}),
    });
  });
  next();
};
