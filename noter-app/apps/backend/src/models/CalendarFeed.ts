import mongoose, { Schema, Document } from 'mongoose';

/**
 * Calendar/CalDAV SHARE ("delning").
 *
 * A share is a user-named collection that covers a SET of task-lists (or all tasks),
 * exposed under ONE ICS calendar link (token) AND ONE CalDAV credential (davUser +
 * hashed secret). The user manages shares in Settings — pick one list, several, or all.
 *
 * Task titles/dates are END-TO-END ENCRYPTED at rest, so the server can't read them.
 * The client pushes a minimal, lock-aware plaintext projection (the union of the
 * share's lists) into `items`; the public ICS endpoint + the CalDAV bridge serve that.
 * CalDAV write-backs that can't touch ciphertext are recorded as `pendingMutations` for
 * the client to apply with the user's key. See routes/calendar.ts + caldav/.
 */
export interface ICalendarItem {
  uid: string;
  title: string;
  start: string;   // ISO date/datetime
  allDay: boolean;
  completed?: boolean;
  description?: string;
  priority?: number; // RFC 5545 PRIORITY 0–9
}

export interface ICalendarMutation {
  id: string;
  uid: string;
  op: 'upsert' | 'delete';
  listId: string | null; // kept for diagnostics; shares carry listIds
  data?: { summary?: string; description?: string; due?: string | null; priority?: number; completed?: boolean };
  at: Date;
}

export interface ICalendarFeed extends Document {
  userId: string;
  /** Stable per-user id for this share (routing key; not a secret). */
  shareId: string;
  /** User-chosen display name ("Jobb", "Alla uppgifter", …). */
  name: string;
  /** Task-list/project note ids this share covers. Empty = all tasks. */
  listIds: string[];
  token: string;
  items: ICalendarItem[];
  updatedAt: Date;
  davUser?: string | null;
  davTokenHash?: string | null;
  davCreatedAt?: Date | null;
  davLastSeenAt?: Date | null;
  pendingMutations?: ICalendarMutation[];
}

const ItemSchema = new Schema<ICalendarItem>({
  uid: { type: String, required: true },
  title: { type: String, default: '' },
  start: { type: String, required: true },
  allDay: { type: Boolean, default: true },
  completed: { type: Boolean, default: false },
  description: { type: String, default: '' },
  priority: { type: Number, default: 0 },
}, { _id: false });

const MutationSchema = new Schema<ICalendarMutation>({
  id: { type: String, required: true },
  uid: { type: String, required: true },
  op: { type: String, enum: ['upsert', 'delete'], required: true },
  listId: { type: String, default: null },
  data: { type: Schema.Types.Mixed, default: undefined },
  at: { type: Date, default: Date.now },
}, { _id: false });

const CalendarFeedSchema = new Schema<ICalendarFeed>({
  userId: { type: String, required: true, index: true },
  shareId: { type: String, required: true },
  name: { type: String, default: '' },
  listIds: { type: [String], default: [] },
  token: { type: String, required: true, unique: true, index: true },
  items: { type: [ItemSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
  davUser: { type: String, default: null },
  davTokenHash: { type: String, default: null },
  davCreatedAt: { type: Date, default: null },
  davLastSeenAt: { type: Date, default: null },
  pendingMutations: { type: [MutationSchema], default: [] },
});

// One share per (user, shareId). The CalDAV Basic-Auth looks a share up by davUser
// (sparse/partial-unique over string values only — DAV-disabled shares have null).
CalendarFeedSchema.index({ userId: 1, shareId: 1 }, { unique: true });
CalendarFeedSchema.index(
  { davUser: 1 },
  { unique: true, partialFilterExpression: { davUser: { $type: 'string' } } },
);

const CalendarFeed = mongoose.model<ICalendarFeed>('CalendarFeed', CalendarFeedSchema);

/**
 * Reconcile calendarfeeds indexes at boot (prod runs autoIndex off): drop the legacy
 * per-list unique index, ensure the share-based + davUser indexes exist. Idempotent,
 * best-effort. The v1.6 share redesign starts feeds from scratch, so the old
 * `userId_1_listId_1` index is removed.
 */
export const reconcileCalendarFeedIndexes = async (): Promise<void> => {
  try {
    const existing = await CalendarFeed.collection.indexes().catch(() => [] as any[]);
    const drop = (name: string) => {
      if (Array.isArray(existing) && existing.some((i: any) => i.name === name)) {
        return CalendarFeed.collection.dropIndex(name).catch(() => {});
      }
      return Promise.resolve();
    };
    await drop('userId_1'); // very old single-feed-per-user
    await drop('userId_1_listId_1'); // per-list (pre-share)
    await CalendarFeed.collection.createIndex({ userId: 1, shareId: 1 }, { unique: true }).catch(() => {});
    await CalendarFeed.collection
      .createIndex({ davUser: 1 }, { unique: true, partialFilterExpression: { davUser: { $type: 'string' } } })
      .catch(() => {});
  } catch {
    /* best-effort — never block boot on index reconciliation */
  }
};

export default CalendarFeed;
