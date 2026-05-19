import type { Model } from 'mongoose';
import logger from './logger';

/**
 * Helper for performing mongoose bulkWrite operations in safe batches.
 *
 * Why batching:
 *   - MongoDB caps a single bulkWrite at 100k ops AND 16MB doc size.
 *     A naive `Model.bulkWrite(largeArray)` either fails outright or
 *     pegs an event-loop tick for seconds.
 *   - We chunk at 500 ops per batch — empirically the sweet spot for
 *     latency vs. roundtrips on a hot collection.
 *
 * Retries: write-concern errors (network blip, primary step-down) are
 * retried up to 3 times with jittered backoff. Validation/permission
 * errors aren't retried — they'd just fail again.
 */

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_MAX_RETRIES = 3;

export interface BulkUpsertResult {
  matched: number;
  modified: number;
  upserted: number;
}

const isRetryableError = (err: unknown): boolean => {
  const e = err as { code?: number; codeName?: string; name?: string };
  if (!e) return false;
  // Standard transient-error codes per MongoDB's retryable-writes spec.
  if (e.codeName === 'InterruptedAtShutdown' || e.codeName === 'InterruptedDueToReplStateChange') return true;
  if (e.codeName === 'NotMaster' || e.codeName === 'PrimarySteppedDown') return true;
  if (e.code === 11600 || e.code === 11602 || e.code === 10058 || e.code === 13435 || e.code === 13436) return true;
  // Network errors surface with name 'MongoNetworkError'.
  if (e.name === 'MongoNetworkError' || e.name === 'MongoNetworkTimeoutError') return true;
  return false;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const computeBackoff = (attempt: number): number => {
  const base = Math.min(200 * 2 ** attempt, 5_000);
  return Math.floor(Math.random() * base);
};

export interface BulkUpsertOptions {
  /** Documents per batch (default 500, hard-capped at 1000). */
  batchSize?: number;
  /** Total max retries per batch on transient errors. */
  maxRetries?: number;
  /** Mongo `ordered` flag — false lets partial batches succeed. */
  ordered?: boolean;
}

/**
 * Upsert by a unique-key field. Each `doc` is matched by its
 * `[matchKey]` value; missing rows are inserted, existing rows
 * `$set`-overwritten.
 */
export const bulkUpsert = async <T extends Record<string, unknown>>(
  model: Model<T>,
  docs: T[],
  matchKey: keyof T & string,
  options: BulkUpsertOptions = {},
): Promise<BulkUpsertResult> => {
  if (!Array.isArray(docs) || docs.length === 0) {
    return { matched: 0, modified: 0, upserted: 0 };
  }
  const batchSize = Math.min(Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const ordered = options.ordered ?? false;

  const totals: BulkUpsertResult = { matched: 0, modified: 0, upserted: 0 };

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const ops = batch
      .filter((d) => d && d[matchKey] !== undefined && d[matchKey] !== null)
      .map((d) => ({
        updateOne: {
          filter: { [matchKey]: d[matchKey] } as Record<string, unknown>,
          update: { $set: d },
          upsert: true,
        },
      }));
    if (ops.length === 0) continue;

    let attempt = 0;
    while (true) {
      try {
        const res = await (model as unknown as { bulkWrite: (o: unknown[], opts: unknown) => Promise<{
          matchedCount: number; modifiedCount: number; upsertedCount: number;
        }> }).bulkWrite(ops, { ordered });
        totals.matched += res.matchedCount;
        totals.modified += res.modifiedCount;
        totals.upserted += res.upsertedCount;
        break;
      } catch (err) {
        if (attempt < maxRetries && isRetryableError(err)) {
          attempt++;
          const wait = computeBackoff(attempt);
          logger.warn('bulkUpsert: transient error, retrying', {
            attempt, waitMs: wait, error: (err as Error)?.message,
          });
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  }
  return totals;
};

// Pure helpers for tests
export const _isRetryableError = isRetryableError;
export const _computeBackoff = computeBackoff;
export const _DEFAULT_BATCH_SIZE = DEFAULT_BATCH_SIZE;
export const _MAX_BATCH_SIZE = MAX_BATCH_SIZE;

/** Pure batching utility — split an array into chunks of `size`. */
export const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
