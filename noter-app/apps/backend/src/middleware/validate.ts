import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, { stripUnknown: true });
    if (error) {
      const message = error?.details?.[0]?.message || 'Invalid request payload';
      return res.status(400).json({ message });
    }
    req.body = value; // Update body with sanitized values
    next();
  };
};
