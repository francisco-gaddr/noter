import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import logger from '../utils/logger';

/**
 * Lightweight write-audit middleware.
 *
 * Logs every mutating HTTP request (POST/PUT/PATCH/DELETE) to a dedicated
 * `_audit_log` collection AFTER the response was sent successfully. Captures:
 *   actor (userId, tenant.orgId)
 *   route (method + sanitised path)
 *   status code
 *   request-id for cross-correlation with the structured log
 *   timestamp
 *   body shape (top-level keys only — never values, to avoid leaking PII
 *     and to keep the audit collection compact)
 *
 * The log is best-effort: a failure here never breaks the request. Insertion
 * happens AFTER the response so a slow audit-store can't affect user-perceived
 * latency.
 *
 * Why not just structured logs (round 5): the request-completion log is
 * forwarded to broader sinks (Loki / Cloudwatch). The audit collection lives
 * inside the application's own database — same encryption, same access
 * control, queryable from the same tools the operator already has.
 */

const COLLECTION = '_audit_log';
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'refresh', 'secret', 'apikey', 'authorization',
  'content', 'title', 'iv', 'ciphertext', 'email', 'phone',
]);

/**
 * Strip PII/secret values, leaving just key names + value shapes ("string",
 * "number[]", "object", etc.). The shape is enough to reconstruct the
 * intent of a request without ever recording what the user typed.
 */
export const summariseBodyShape = (body: unknown, depth = 0): unknown => {
  if (depth > 3) return '…';
  if (body === null || body === undefined) return body === null ? null : 'undefined';
  if (Array.isArray(body)) {
    if (body.length === 0) return '[]';
    return [`[${body.length}]`, summariseBodyShape(body[0], depth + 1)];
  }
  if (typeof body === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        out[k] = summariseBodyShape(v, depth + 1);
      } else if (Array.isArray(v)) {
        out[k] = `${typeof (v[0])}[${v.length}]`;
      } else {
        out[k] = typeof v;
      }
    }
    return out;
  }
  return typeof body;
};

const sanitiseRoutePath = (req: Request): string => {
  const matched = (req.route && (req.route as { path?: string }).path) || req.path || 'unknown';
  return matched;
};

interface AuditEntry {
  ts: Date;
  actorUserId?: string;
  actorOrgId?: string;
  method: string;
  route: string;
  status: number;
  requestId?: string;
  bodyShape?: unknown;
}

const writeEntry = async (entry: AuditEntry): Promise<void> => {
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.db) return;
    await conn.db.collection<AuditEntry>(COLLECTION).insertOne(entry);
  } catch (err) {
    // Audit failure is logged at warn but never propagated.
    logger.warn('audit-log: write failed', { error: (err as Error)?.message });
  }
};

/**
 * Mount this on the route groups that mutate state. We deliberately skip
 * GET — they're audited by the structured request log, and writing a row
 * per GET would dominate the audit collection.
 */
export const auditLog = () => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const m = req.method.toUpperCase();
    if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return next();

    // Snapshot body shape NOW because the route handler can mutate req.body.
    const bodyShape = summariseBodyShape(req.body);

    res.on('finish', () => {
      // Only audit "successful" mutations. 4xx/5xx are already captured by
      // the request log; writing them to audit too would bloat the table.
      if (res.statusCode >= 400) return;
      const reqWithUser = req as Request & { user?: { userId?: string }; tenant?: { orgId?: string }; requestId?: string };
      const entry: AuditEntry = {
        ts: new Date(),
        actorUserId: reqWithUser.user?.userId,
        actorOrgId: reqWithUser.tenant?.orgId,
        method: m,
        route: sanitiseRoutePath(req),
        status: res.statusCode,
        requestId: reqWithUser.requestId,
        bodyShape,
      };
      // Fire-and-forget; we never await this in the middleware chain.
      void writeEntry(entry);
    });
    next();
  };
};
