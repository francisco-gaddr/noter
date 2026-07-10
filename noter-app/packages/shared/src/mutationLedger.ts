/**
 * Idempotency ledger for draining server-queued mutations (CalDAV + Markdown write-backs).
 *
 * The problem: a client drains pending mutations, applies each, then ACKs the applied ids. The
 * ACK is best-effort — if it's lost (offline, crash between apply and ack), the mutation stays on
 * the server and the NEXT drain returns it again. Re-applying a non-idempotent write (e.g. "create
 * task") produces a DUPLICATE.
 *
 * The fix (industry standard — exactly-once via idempotency keys, see OWASP/Stripe/AWS guidance):
 * each mutation already carries a unique `id` (its idempotency key). We keep a bounded ledger of
 * ids we've already applied THIS session; a re-drained mutation whose id is in the ledger is
 * skipped (we still re-ACK it so the server can drop it) instead of re-applied. The ledger is a
 * FIFO bounded to the replay horizon — old ids age out so it can't grow without bound.
 *
 * Pure + framework-free so it is shared by web + mobile, and unit-tested in isolation.
 */

export interface AppliedLedger {
  /** Has this mutation id already been applied this session? */
  has(id: string): boolean;
  /** Record a mutation id as applied (no-op for empty/duplicate ids). */
  add(id: string): void;
  /** Number of ids currently retained (diagnostics / tests). */
  size(): number;
}

/** Default replay horizon — comfortably larger than any realistic offline backlog. */
export const DEFAULT_LEDGER_SIZE = 500;

export const createAppliedLedger = (maxSize: number = DEFAULT_LEDGER_SIZE): AppliedLedger => {
  const cap = Math.max(1, Math.floor(maxSize));
  const ids = new Set<string>();
  const order: string[] = []; // insertion order, for FIFO eviction
  return {
    has: (id) => typeof id === 'string' && ids.has(id),
    add: (id) => {
      if (typeof id !== 'string' || !id || ids.has(id)) return;
      ids.add(id);
      order.push(id);
      while (order.length > cap) {
        const oldest = order.shift();
        if (oldest !== undefined) ids.delete(oldest);
      }
    },
    size: () => ids.size,
  };
};

/**
 * Drain a batch of mutations through the ledger exactly once. For each mutation:
 *   - already applied (id in the ledger) → skipped, but its id is still returned so the caller
 *     re-ACKs it (the server can then drop the now-confirmed mutation);
 *   - not yet applied → `apply(m)` is awaited; on success the id is recorded + returned; on failure
 *     it is left un-applied and un-returned so it retries on the next drain.
 * Returns the ids to ACK (applied-now ∪ already-applied). Never throws — a single mutation's failure
 * doesn't abort the batch.
 */
/** After this many failed applies of the SAME mutation it is quarantined: acked-and-dropped so a
 *  poison message (malformed body, deleted parent, permanent 4xx) can't re-fail on every drain
 *  forever. Failures are counted across drains within the session. */
export const POISON_MUTATION_MAX_ATTEMPTS = 5;

const failureCounts = new WeakMap<AppliedLedger, Map<string, number>>();

export const applyMutationsOnce = async <M extends { id: string }>(
  mutations: M[],
  ledger: AppliedLedger,
  apply: (mutation: M) => Promise<void>,
  onQuarantine?: (mutation: M, error: unknown) => void,
): Promise<string[]> => {
  const ackIds: string[] = [];
  let failures = failureCounts.get(ledger);
  if (!failures) { failures = new Map(); failureCounts.set(ledger, failures); }
  for (const m of Array.isArray(mutations) ? mutations : []) {
    if (!m || typeof m.id !== 'string' || !m.id) continue;
    if (ledger.has(m.id)) { ackIds.push(m.id); continue; } // duplicate redelivery — re-ack, don't re-apply
    try {
      await apply(m);
      ledger.add(m.id);
      ackIds.push(m.id);
      failures.delete(m.id);
    } catch (error) {
      const attempts = (failures.get(m.id) ?? 0) + 1;
      failures.set(m.id, attempts);
      if (attempts >= POISON_MUTATION_MAX_ATTEMPTS) {
        // Poison: quarantine by acking WITHOUT applying — the server drops it and the drain
        // loop stops re-failing on it. The caller is told so it can log/surface the loss.
        ledger.add(m.id);
        ackIds.push(m.id);
        failures.delete(m.id);
        try { onQuarantine?.(m, error); } catch { /* observer must not break the drain */ }
      }
      // otherwise: leave un-acked — it stays queued and retries on the next drain
    }
  }
  return ackIds;
};
