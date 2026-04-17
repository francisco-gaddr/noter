import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isServerError = statusCode >= 500;
  const safeMessage = isServerError ? 'Internal server error' : (err?.message || 'Request failed');
  if (isServerError) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.path,
      status: statusCode,
      error: err?.message || String(err),
    });
  }
  res.status(statusCode).json({
    message: safeMessage,
    stack: process.env.NODE_ENV === 'production' ? null : err?.stack,
  });
};
