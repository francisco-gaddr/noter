import type { Schema, Query } from 'mongoose';

/**
 * Soft-delete plugin for mongoose schemas.
 *
 * Why: deleting a note today writes nothing — the row is gone. That makes
 * recovery impossible and breaks change-stream downstream consumers that
 * expect a "tombstone" they can propagate. Soft-delete keeps the document
 * around with `deletedAt` set, while every default query auto-filters it
 * out so callers don't see deleted items unless they explicitly opt in.
 *
 * Adds:
 *   - `deletedAt: Date | null` field
 *   - `Model.softDelete(filter)` — sets deletedAt = now
 *   - `Model.restore(filter)` — clears deletedAt
 *   - `Model.findDeleted(filter)` — finds only soft-deleted
 *   - `Model.findWithDeleted(filter)` — includes soft-deleted
 *
 * Default query behaviour transparently injects `{ deletedAt: null }` on
 * all `find*` / `count*` / `updateMany*` / `aggregate` (first $match stage)
 * operations. Opt out per-query via `.setOptions({ withDeleted: true })`.
 */

interface SoftDeletePluginOptions {
  /** Index `deletedAt`? Default true. */
  index?: boolean;
}

interface SoftDeleteMethods {
  softDelete(filter: Record<string, unknown>): Promise<{ matched: number; modified: number }>;
  restore(filter: Record<string, unknown>): Promise<{ matched: number; modified: number }>;
  findDeleted(filter?: Record<string, unknown>): Query<unknown[], unknown>;
  findWithDeleted(filter?: Record<string, unknown>): Query<unknown[], unknown>;
}

const QUERY_OPS_TO_FILTER = [
  'count', 'countDocuments', 'estimatedDocumentCount',
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateMany', 'updateOne', 'replaceOne',
] as const;

export const softDeletePlugin = (schema: Schema, options: SoftDeletePluginOptions = {}): void => {
  schema.add({ deletedAt: { type: Date, default: null } });
  if (options.index !== false) {
    schema.index({ deletedAt: 1 });
  }

  // Inject `{ deletedAt: null }` into every default query unless the caller
  // opted in with `setOptions({ withDeleted: true })`.
  for (const op of QUERY_OPS_TO_FILTER) {
    schema.pre(op as 'find', function (this: Query<unknown, unknown>) {
      const opts = this.getOptions() as { withDeleted?: boolean };
      if (opts.withDeleted) return;
      const filter = this.getFilter() as Record<string, unknown>;
      // Only inject if the caller hasn't already touched deletedAt.
      if (!('deletedAt' in filter)) {
        this.setQuery({ ...filter, deletedAt: null });
      }
    });
  }

  // Aggregate pipelines: inject a $match at the start unless the first stage
  // already filters deletedAt. The mongoose typings type `pre('aggregate')`
  // differently from the query hooks, so we cast through `unknown` here —
  // we'd rather have the runtime behaviour than fight the overload set.
  (schema as unknown as { pre: (op: string, fn: (this: any) => void) => void })
    .pre('aggregate', function (this: { pipeline(): unknown[]; options?: { withDeleted?: boolean } }) {
      if (this.options?.withDeleted) return;
      const pipeline = this.pipeline();
      const first = pipeline[0] as { $match?: Record<string, unknown> } | undefined;
      if (first?.$match && 'deletedAt' in first.$match) return;
      pipeline.unshift({ $match: { deletedAt: null } });
    });

  schema.statics.softDelete = async function (filter: Record<string, unknown>) {
    const res = await (this as { updateMany: (f: unknown, u: unknown) => Promise<{ matchedCount: number; modifiedCount: number }> })
      .updateMany({ ...filter, deletedAt: null }, { $set: { deletedAt: new Date() } });
    return { matched: res.matchedCount, modified: res.modifiedCount };
  };

  schema.statics.restore = async function (filter: Record<string, unknown>) {
    // Filter must include `deletedAt: { $ne: null }` so we don't accidentally
    // touch live rows. The user supplies whatever extra criteria they need.
    const res = await (this as { updateMany: (f: unknown, u: unknown) => Promise<{ matchedCount: number; modifiedCount: number }> })
      .updateMany({ ...filter, deletedAt: { $ne: null } } as any, { $set: { deletedAt: null } });
    return { matched: res.matchedCount, modified: res.modifiedCount };
  };

  schema.statics.findDeleted = function (filter: Record<string, unknown> = {}) {
    return (this as { find: (f: unknown, p?: unknown, o?: unknown) => Query<unknown[], unknown> })
      .find({ ...filter, deletedAt: { $ne: null } } as any, null, { withDeleted: true });
  };

  schema.statics.findWithDeleted = function (filter: Record<string, unknown> = {}) {
    return (this as { find: (f: unknown, p?: unknown, o?: unknown) => Query<unknown[], unknown> })
      .find(filter as any, null, { withDeleted: true });
  };
};

export type { SoftDeleteMethods };

// Test helpers for the filter-injection logic without a live mongo.
export const _filterInjector = (filter: Record<string, unknown>, withDeleted: boolean): Record<string, unknown> => {
  if (withDeleted) return filter;
  if ('deletedAt' in filter) return filter;
  return { ...filter, deletedAt: null };
};

export const _aggregateInjector = (pipeline: unknown[], withDeleted: boolean): unknown[] => {
  if (withDeleted) return pipeline;
  const first = pipeline[0] as { $match?: Record<string, unknown> } | undefined;
  if (first?.$match && 'deletedAt' in first.$match) return pipeline;
  return [{ $match: { deletedAt: null } }, ...pipeline];
};
