import mongoose from 'mongoose';
import type { Query, Model, FilterQuery } from 'mongoose';
import logger from './logger';

/**
 * Helpers for routing read queries to a MongoDB replica-set secondary.
 *
 * Why: read-heavy paths (note listings, search facets, dashboards) don't
 * need primary-fresh consistency; serving them from a secondary cuts
 * primary load and lets us scale reads independently of writes. The
 * tradeoff is replication lag — `secondaryPreferred` accepts up to
 * ~seconds of staleness in exchange for offloading the read.
 *
 * Behaviour:
 *   - `runWithReadPreference(query, 'secondaryPreferred')` sets `.read()`
 *     on the query. If the cluster has no secondary (single-node dev,
 *     standalone Mongo), mongoose silently routes to primary — safe
 *     default.
 *   - `READ_PREFERENCE` env var configures the global default for
 *     application-level read helpers (`findManyForRead`).
 *
 * staleness:
 *   - `maxStalenessSeconds` is honoured by the driver when set; we default
 *     to 90 (3× heartbeat interval, the minimum the driver accepts).
 */

export type ReadPreference =
  | 'primary'
  | 'primaryPreferred'
  | 'secondary'
  | 'secondaryPreferred'
  | 'nearest';

const VALID_PREFS = new Set<ReadPreference>([
  'primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest',
]);

const MIN_STALENESS_SECONDS = 90;

export const resolveReadPreference = (raw: string | undefined): ReadPreference => {
  if (!raw) return 'primary';
  const trimmed = raw.trim();
  if (VALID_PREFS.has(trimmed as ReadPreference)) return trimmed as ReadPreference;
  logger.warn('readPreference: unknown value, defaulting to primary', { raw });
  return 'primary';
};

const DEFAULT_PREF = resolveReadPreference(process.env.MONGOOSE_READ_PREFERENCE);

export const getDefaultReadPreference = (): ReadPreference => DEFAULT_PREF;

interface ReadOptions {
  preference?: ReadPreference;
  maxStalenessSeconds?: number;
}

/**
 * Mark a mongoose query to use the given preference. Returns the same
 * query for chainability so callers can do
 *   `await runWithReadPreference(Note.find({…}), 'secondaryPreferred')`
 */
export const runWithReadPreference = <T, U>(
  query: Query<T, U>,
  preference: ReadPreference = DEFAULT_PREF,
  opts: ReadOptions = {},
): Query<T, U> => {
  const maxStaleness = opts.maxStalenessSeconds && opts.maxStalenessSeconds >= MIN_STALENESS_SECONDS
    ? opts.maxStalenessSeconds
    : undefined;
  try {
    // The mongoose Query#read overload accepts a tags array as second arg;
    // we don't use tags but pass undefined explicitly. maxStalenessSeconds is
    // surfaced via the driver options object on `.read()` in recent mongoose.
    if (maxStaleness !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any).read({ mode: preference, maxStalenessSeconds: maxStaleness });
    } else {
      query.read(preference);
    }
  } catch (err) {
    logger.warn('readPreference: setting preference failed', {
      preference,
      error: (err as Error)?.message,
    });
  }
  return query;
};

/**
 * Convenience: do a "read-only" find with the default secondary-preference.
 *
 * Call this from list endpoints (`/api/notes`, `/api/tasks`) where eventual
 * consistency is fine. Use the regular `Model.find()` for read-after-write
 * paths (just-created note → fetch by id).
 */
export const findManyForRead = <T extends mongoose.Document, F = FilterQuery<T>>(
  model: Model<T>,
  filter: F,
  opts: ReadOptions = {},
): Query<T[], T> => {
  const q = model.find(filter as FilterQuery<T>);
  return runWithReadPreference(q, opts.preference, opts) as Query<T[], T>;
};

export const _MIN_STALENESS_SECONDS = MIN_STALENESS_SECONDS;
