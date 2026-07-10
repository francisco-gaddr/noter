/**
 * The single source of truth for "what data we hold about a user", consumed by BOTH the GDPR
 * data-export (right of access / portability, Art. 15/20) and account-deletion (right to erasure,
 * Art. 17). Defining the collection set ONCE means export and delete can never drift — a new
 * user-keyed collection is added here and both flows pick it up.
 *
 * E2E note: note/task/AI content is end-to-end-encrypted ciphertext the server cannot read. The
 * export returns that ciphertext AS-IS plus the user's keyBundle, so the user's own client can
 * decrypt it locally. Secrets (the password hash, API-key hashes) are never exported.
 */
import mongoose from 'mongoose';
import logger from '../utils/logger';
import User from '../models/User';
import Note from '../models/Note';
import Task from '../models/Task';
import CalendarFeed from '../models/CalendarFeed';
import MarkdownShare from '../models/MarkdownShare';
import AIConversationSync from '../models/AIConversationSync';
import AIMessageSync from '../models/AIMessageSync';
import AIProjectSync from '../models/AIProjectSync';
import PushToken from '../models/PushToken';
import McpAuditLog from '../models/McpAuditLog';

type Redact = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Mongoose-model collections keyed by userId. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const USER_MODELS: Array<{ key: string; model: mongoose.Model<any>; field: string; redact?: Redact }> = [
  { key: 'notes', model: Note, field: 'userId' },
  { key: 'tasks', model: Task, field: 'userId' },
  { key: 'calendarFeeds', model: CalendarFeed, field: 'userId' },
  { key: 'markdownShares', model: MarkdownShare, field: 'userId' },
  { key: 'aiConversations', model: AIConversationSync, field: 'userId' },
  { key: 'aiMessages', model: AIMessageSync, field: 'userId' },
  { key: 'aiProjects', model: AIProjectSync, field: 'userId' },
  { key: 'pushTokens', model: PushToken, field: 'userId' },
  { key: 'mcpAuditLogs', model: McpAuditLog, field: 'userId' },
];

/** Raw (non-mongoose) collections, with the userId field name each uses. */
const USER_RAW_COLLECTIONS: Array<{ key: string; coll: string; field: string; redact?: Redact }> = [
  // Export API-key METADATA only — never the hash (it's a credential verifier).
  { key: 'apiKeys', coll: '_api_keys', field: 'ownerUserId', redact: (d) => ({ kid: d.kid, scopes: d.scopes, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, revokedAt: d.revokedAt }) },
  { key: 'quotaUsage', coll: '_quota_usage', field: 'userId' },
  { key: 'auditLogs', coll: '_audit_log', field: 'actorUserId' },
];

/** Gather everything we hold for `userId` (GDPR access/portability). */
export const exportUserData = async (userId: string): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    note: 'Note/task/AI content is end-to-end-encrypted ciphertext — decrypt locally with your password + keyBundle. No secrets (password hash, API-key hashes) are included.',
  };
  const user = await User.findById(userId).lean();
  out.user = user
    ? { _id: String(user._id), username: user.username, createdAt: user.createdAt, keyBundle: user.keyBundle ?? null }
    : null;

  // Memory bound for pathological accounts: cap each collection and SAY SO in the export
  // (silent truncation would violate the access right; the marker lets support follow up).
  const EXPORT_CAP = 100_000;
  const truncated: string[] = [];
  for (const c of USER_MODELS) {
    const rows = await c.model.find({ [c.field]: userId }).limit(EXPORT_CAP + 1).lean();
    if (rows.length > EXPORT_CAP) { truncated.push(c.key); rows.length = EXPORT_CAP; }
    out[c.key] = c.redact ? rows.map((r) => c.redact!(r as Record<string, unknown>)) : rows;
  }
  const db = mongoose.connection.db;
  for (const c of USER_RAW_COLLECTIONS) {
    if (!db) { out[c.key] = []; continue; }
    const rows = await db.collection(c.coll).find({ [c.field]: userId }).limit(EXPORT_CAP + 1).toArray();
    if (rows.length > EXPORT_CAP) { truncated.push(c.key); rows.length = EXPORT_CAP; }
    out[c.key] = c.redact ? rows.map((r) => c.redact!(r as Record<string, unknown>)) : rows;
  }
  if (truncated.length) out.truncatedCollections = truncated;
  return out;
};

/** Permanently delete every record we hold for `userId` (GDPR erasure — HARD delete). Returns a
 *  per-collection deleted-count summary for the audit trail. Backend metadata (_instances,
 *  _migrations) is never user-keyed and is left untouched. */
export const deleteUserData = async (userId: string): Promise<{ deleted: Record<string, number>; totalDeleted: number }> => {
  // Not transactional (standalone Mongo has no multi-doc transactions) but SAFELY RE-RUNNABLE by
  // construction: deleteMany is idempotent and the User row is deleted LAST, so a mid-way failure
  // leaves the account intact and a retried call finishes the job. On failure we log which
  // collections were already purged so the partial progress is visible in the audit trail.
  const deleted: Record<string, number> = {};
  try {
  for (const c of USER_MODELS) {
    const r = await c.model.deleteMany({ [c.field]: userId });
    deleted[c.key] = r.deletedCount ?? 0;
  }
  const db = mongoose.connection.db;
  if (db) {
    for (const c of USER_RAW_COLLECTIONS) {
      const r = await db.collection(c.coll).deleteMany({ [c.field]: userId });
      deleted[c.key] = r.deletedCount ?? 0;
    }
  }
  const u = await User.deleteOne({ _id: userId });
  deleted.user = u.deletedCount ?? 0;
  } catch (err) {
    logger.warn('userData.delete-partial', { userId, purged: Object.keys(deleted), error: (err as Error)?.message });
    throw err; // the route 500s; a client retry completes the remaining collections + the user row
  }
  const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
  return { deleted, totalDeleted };
};

/** Collection keys covered (diagnostics / tests — proves the set is complete). */
export const userDataKeys = (): string[] => [...USER_MODELS.map((c) => c.key), ...USER_RAW_COLLECTIONS.map((c) => c.key), 'user'];
