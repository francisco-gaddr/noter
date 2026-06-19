import type { Model } from 'mongoose';

/**
 * ACK a batch of pending write-back mutations by id: pull them from the user's documents and return
 * how many were ACTUALLY removed.
 *
 * The old endpoints returned `ids.length` (the REQUESTED count) regardless of what was really in the
 * queue — so a client could never tell whether its ACK took effect. Returning the true removed count
 * lets the client confirm the durable state and, combined with the client-side idempotency ledger
 * (@repo/shared/mutationLedger), reconcile a partially-applied ACK without re-applying anything.
 *
 * Shared by the CalDAV (`CalendarFeed`) and Markdown (`MarkdownShare`) ack endpoints — both store
 * `pendingMutations: [{ id, ... }]`.
 */
export const ackPendingMutations = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Model: Model<any>,
  userId: string,
  ids: string[],
): Promise<number> => {
  if (!ids.length) return 0;
  const idSet = new Set(ids);
  const docs = await Model.find(
    { userId, 'pendingMutations.id': { $in: ids } },
    { pendingMutations: 1 },
  ).lean();
  const removed = docs.reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n: number, d: any) =>
      n + (Array.isArray(d.pendingMutations)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? d.pendingMutations.filter((m: any) => idSet.has(m?.id)).length
        : 0),
    0,
  );
  await Model.updateMany({ userId }, { $pull: { pendingMutations: { id: { $in: ids } } } });
  return removed;
};
