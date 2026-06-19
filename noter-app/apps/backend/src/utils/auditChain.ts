import { createHmac } from 'node:crypto';

/**
 * Tamper-evident audit-log chaining (HMAC-SHA256 hash chain — the 2026 standard for immutable audit
 * trails; "append-only is not tamper-evident").
 *
 * Each entry carries `prevHash` (the previous entry's hash) and `hash = HMAC(key, prevHash + canonical
 * content)`. The key is an OPERATOR secret kept OUT of the database (env), so an attacker who only has
 * DB access cannot forge a valid hash for a modified or inserted entry. Re-walking the chain detects:
 *   - MODIFICATION — a changed entry's recomputed hash won't match;
 *   - DELETION / REORDER — the next entry's `prevHash` won't link to the previous `hash`.
 *
 * Pure + dependency-light so it's unit-tested in isolation and reused by every audit stream.
 */

/** Deterministic JSON: object keys sorted, Dates as ISO — so the same logical entry always hashes
 *  identically regardless of property order or Date instances. */
export const canonicalJson = (value: unknown): string => {
  const seen = new WeakSet<object>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const norm = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return null; // guard against cycles
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
};

/** HMAC-SHA256 chaining hash tying this entry's sealed content to the previous entry's hash. */
export const auditChainHash = (key: string, prevHash: string, sealedContent: unknown): string =>
  createHmac('sha256', key || 'audit-key-unset')
    .update(`${prevHash}\n${canonicalJson(sealedContent)}`)
    .digest('hex');

export interface ChainedEntry {
  prevHash?: string;
  hash?: string;
  [k: string]: unknown;
}

export interface ChainVerification {
  ok: boolean;
  /** Index of the first broken entry, or -1 when the whole chain is intact. */
  brokenAt: number;
  /** 'modified' = a recomputed hash mismatched; 'unlinked' = a prevHash didn't link. */
  reason?: 'modified' | 'unlinked';
}

/**
 * Verify a chain of entries (in ascending order). `sealedOf` returns the content that was hashed
 * (the entry minus hash/prevHash and any storage-only fields like _id). Race-free + read-only.
 */
export const verifyAuditChain = (
  key: string,
  entries: ChainedEntry[],
  sealedOf: (e: ChainedEntry) => unknown,
  genesisPrev = '',
): ChainVerification => {
  let prev = genesisPrev;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if ((e.prevHash ?? '') !== prev) return { ok: false, brokenAt: i, reason: 'unlinked' };
    if (e.hash !== auditChainHash(key, prev, sealedOf(e))) return { ok: false, brokenAt: i, reason: 'modified' };
    prev = e.hash;
  }
  return { ok: true, brokenAt: -1 };
};
