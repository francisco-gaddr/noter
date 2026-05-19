import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { BadRequestError } from '../utils/httpErrors';

type Source = 'body' | 'query' | 'params';

interface ValidateOptions {
  /** Where to read the value from. Default 'body'. */
  source?: Source;
  /** Allow unknown fields (default false — strip-unknown is safer). */
  allowUnknown?: boolean;
}

const validateAt = (source: Source, schema: Joi.Schema, opts: ValidateOptions = {}) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const input = (req as any)[source];
    const { error, value } = schema.validate(input, {
      stripUnknown: !opts.allowUnknown,
      abortEarly: false,
      convert: true,
    });
    if (error) {
      // Surface every validation failure (not just first) so the client can
      // fix all fields in one pass. We pass through `isJoi` for the error
      // middleware to recognise it.
      next(new BadRequestError('Validation failed', {
        code: 'VALIDATION_FAILED',
        details: {
          source,
          issues: (error.details || []).map((d) => ({
            path: Array.isArray(d.path) ? d.path.join('.') : String(d.path ?? ''),
            message: d.message,
            type: d.type,
          })),
        },
      }));
      return;
    }
    (req as any)[source] = value;
    next();
  };
};

/**
 * Back-compat: validates `req.body` against the given schema. Existing
 * call sites can keep using `validate(schema)`.
 */
export const validate = (schema: Joi.Schema, options: ValidateOptions = {}) =>
  validateAt(options.source ?? 'body', schema, options);

export const validateBody = (schema: Joi.Schema, opts?: ValidateOptions) =>
  validateAt('body', schema, opts);
export const validateQuery = (schema: Joi.Schema, opts?: ValidateOptions) =>
  validateAt('query', schema, opts);
export const validateParams = (schema: Joi.Schema, opts?: ValidateOptions) =>
  validateAt('params', schema, opts);

// Common building blocks for use across route files.
export const schemas = {
  objectId: Joi.string().pattern(/^[a-fA-F0-9]{24}$/).message('must be a 24-char hex ObjectId'),
  cursor: Joi.string().pattern(/^[A-Za-z0-9_-]+$/).max(256),
  limit: Joi.number().integer().min(1).max(100),
};
