import { Request, Response, NextFunction } from 'express';
import { HttpError, isHttpError } from '../utils/httpErrors';
import logger from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as Request & { requestId?: string }).requestId;

  // Typed HttpError: trust the carried status + code, delegate JSON shape.
  if (isHttpError(err)) {
    const payload = (err as HttpError).toClientJSON();
    if (err.status >= 500) {
      logger.error('http.error', { requestId, status: err.status, code: err.code, message: err.message, stack: err.stack });
    } else {
      logger.warn('http.error', { requestId, status: err.status, code: err.code, message: err.message });
    }
    res.status(err.status).json({
      ...payload,
      requestId,
    });
    return;
  }

  // Joi validation errors: convert to 400 with details if Joi is responsible.
  if (err && err.isJoi === true) {
    const details = Array.isArray(err.details)
      ? err.details.map((d: any) => ({
          path: Array.isArray(d.path) ? d.path.join('.') : String(d.path ?? ''),
          message: d.message,
          type: d.type,
        }))
      : undefined;
    logger.warn('validation.error', { requestId, details });
    res.status(400).json({
      message: 'Validation failed',
      code: 'BAD_REQUEST',
      details,
      requestId,
    });
    return;
  }

  // Anything else: treat as 500. Do NOT leak err.message — it might contain
  // internals (file paths, stack frames) the attacker would benefit from.
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isServerError = statusCode >= 500;
  const safeMessage = isServerError ? 'Internal server error' : (err?.message || 'Request failed');

  logger.error('uncaught.error', {
    requestId,
    status: statusCode,
    name: err?.name,
    message: err?.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  });

  res.status(statusCode).json({
    message: safeMessage,
    code: isServerError ? 'INTERNAL' : 'CLIENT_ERROR',
    stack: process.env.NODE_ENV === 'production' ? null : err?.stack,
    requestId,
  });
};
