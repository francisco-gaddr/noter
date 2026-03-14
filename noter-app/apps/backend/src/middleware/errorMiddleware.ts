import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isServerError = statusCode >= 500;
  const safeMessage = isServerError ? 'Internal server error' : (err?.message || 'Request failed');
  res.status(statusCode).json({
    message: safeMessage,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};
