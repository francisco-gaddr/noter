import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import logger from '../utils/logger';
import { auditChainHash } from '../utils/auditChain';

// HMAC key for the tamper-evident chain. Kept OUT of the DB (env) so a DB-only attacker can't forge
// a hash for a modified entry. Falls back to JWT_SECRET; validateEnv warns if neither is set in prod.
const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || process.env.JWT_SECRET || '';

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

/** The fields that are HMAC-sealed into the chain (everything except the chain fields + _id). Exported
 *  so a verification job can re-derive each entry's hash. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auditSealedFields = (e: any): Record<string, unknown> => ({
  ts: e.ts instanceof Date ? e.ts.toISOString() : e.ts,
  actorUserId: e.actorUserId ?? null,
  actorOrgId: e.actorOrgId ?? null,
  method: e.method,
  route: e.route,
  status: e.status,
  requestId: e.requestId ?? null,
  bodyShape: e.bodyShape ?? null,
  seq: e.seq,
});

export const auditLogCollectionName = (): string => COLLECTION;

// In-process serialized chain head so each entry's prevHash is the IMMEDIATELY-prior entry's hash.
// Single-pod correct (the Pi deploy); a multi-pod deploy would fork the chain per pod — documented as
// a follow-up (a DB-atomic head CAS would make it globally serial).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chainHead: Promise<{ hash: string; seq: number }> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readChainHead = async (coll: any): Promise<{ hash: string; seq: number }> => {
  try {
    const last = await coll.find({}, { projection: { hash: 1, seq: 1 } }).sort({ seq: -1 }).limit(1).next();
    return { hash: (last?.hash as string) || '', seq: (last?.seq as number) || 0 };
  } catch {
    return { hash: '', seq: 0 };
  }
};

const writeEntry = async (entry: AuditEntry): Promise<void> => {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) return;
  const coll = conn.db.collection(COLLECTION);
  const prev = chainHead ?? readChainHead(coll); // read+set is atomic (single-threaded, no await between)
  chainHead = (async () => {
    const head = await prev;
    const seq = head.seq + 1;
    const sealed = auditSealedFields({ ...entry, seq });
    const hash = auditChainHash(AUDIT_HMAC_KEY, head.hash, sealed);
    await coll.insertOne({ ...entry, seq, prevHash: head.hash, hash });
    return { hash, seq };
  })().catch((err) => {
    // On failure the entry wasn't written → keep the previous head so the chain stays intact.
    logger.warn('audit-log: write failed', { error: (err as Error)?.message });
    return prev;
  });
  await chainHead.catch(() => {});
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
