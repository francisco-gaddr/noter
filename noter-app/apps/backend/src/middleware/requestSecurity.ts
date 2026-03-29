import { Request, Response, NextFunction } from 'express';

const FORBIDDEN_KEY_PATTERN = /(^\$)|\./;
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const hasForbiddenKeys = (value: unknown): boolean => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeys(item));
  if (typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) return true;
    if (FORBIDDEN_KEY_PATTERN.test(key)) return true;
    if (hasForbiddenKeys(child)) return true;
  }
  return false;
};

const hasDangerousUrlPattern = (input: string): boolean => {
  const decoded = (() => {
    try {
      return decodeURIComponent(input);
    } catch {
      return input;
    }
  })();
  const lowered = decoded.toLowerCase();
  if (lowered.includes('$where') || lowered.includes('$gt') || lowered.includes('$ne') || lowered.includes('$regex')) return true;
  if (lowered.includes('__proto__') || lowered.includes('constructor') || lowered.includes('prototype')) return true;
  if (lowered.includes(' union select ') || lowered.includes(';--') || lowered.includes('/*') || lowered.includes('*/')) return true;
  return false;
};

export const enforceJsonApiRequests = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/')) return next();
  const method = req.method.toUpperCase();
  const requiresBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  if (!requiresBody) return next();
  const hasBodyHeader = Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
  if (!hasBodyHeader) return next();
  if (!req.is('application/json')) {
    return res.status(415).json({ message: 'Only application/json is supported' });
  }
  return next();
};

export const blockSuspiciousRequestPatterns = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/')) return next();
  if ((req.originalUrl || '').length > 2048) {
    return res.status(414).json({ message: 'Request URL is too long' });
  }
  if (hasDangerousUrlPattern(req.originalUrl)) {
    return res.status(400).json({ message: 'Suspicious request blocked' });
  }
  if (hasForbiddenKeys(req.query) || hasForbiddenKeys(req.body) || hasForbiddenKeys(req.params)) {
    return res.status(400).json({ message: 'Suspicious payload blocked' });
  }
  return next();
};

