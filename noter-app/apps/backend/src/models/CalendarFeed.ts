import mongoose, { Schema, Document } from 'mongoose';

/**
 * Calendar subscription feed.
 *
 * Task titles + due dates are END-TO-END ENCRYPTED at rest, so the server can't
 * read them to build an ICS. Instead the client (which has plaintext) pushes a
 * minimal projection here that the public ICS endpoint serves. This is opt-in:
 * the user chooses to expose these fields so an external calendar (Google/Apple)
 * can subscribe — that data inherently leaves the device to the calendar service.
 * Nothing else about the task is stored.
 *
 * The SAME projection also backs the CalDAV bridge (read/write tasks as VTODO from
 * Tasks.org / Apple Reminders). CalDAV write-back can't touch the encrypted Task
 * directly, so an incoming completion/delete is recorded as a `pendingMutations`
 * intent (non-sensitive: uid + op) that the client drains and applies with the
 * user's key, then re-pushes the projection. See routes/calendar.ts + caldav/.
 */
export interface ICalendarItem {
  uid: string;
  title: string;
  start: string;   // ISO date/datetime
  allDay: boolean;
  completed?: boolean;
  /** Optional plaintext notes (VTODO DESCRIPTION). Opt-in, lock-aware (client-filtered). */
  description?: string;
  /** RFC 5545 PRIORITY 0–9 (0 = none). */
  priority?: number;
}

/**
 * A pending CalDAV write-back the client must apply to the real (encrypted) task.
 * Only non-sensitive intent is stored — never plaintext task content beyond what
 * the user already opted to expose in the projection.
 */
export interface ICalendarMutation {
  id: string;                 // random id, used for ack
  uid: string;                // task uid (the projection/clientId/_id)
  op: 'upsert' | 'delete';    // upsert covers complete/uncomplete/edit/create
  listId: string | null;      // scope the mutation came through
  /** Plaintext intent the client applies with the user's key (then re-pushes). */
  data?: {
    summary?: string;
    description?: string;
    due?: string | null;
    priority?: number;
    completed?: boolean;
  };
  at: Date;
}

export interface ICalendarFeed extends Document {
  userId: string;
  /** Scope: null = all dated tasks; otherwise a task-list/project note id. */
  listId: string | null;
  token: string;
  items: ICalendarItem[];
  updatedAt: Date;
  // --- CalDAV credential (separate, hashed secret; the ICS `token` is unchanged) ---
  /** Public Basic-Auth username for CalDAV (non-secret lookup key). Unset = CalDAV off. */
  davUser?: string | null;
  /** SHA-256 of the CalDAV password. The password itself is shown once and never stored. */
  davTokenHash?: string | null;
  /** Plaintext collection display-name the user chose (the list's real name is encrypted). */
  davDisplayName?: string | null;
  davCreatedAt?: Date | null;
  davLastSeenAt?: Date | null;
  /** Pending CalDAV write-backs awaiting client application. */
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
  listId: { type: String, default: null },
  token: { type: String, required: true, unique: true, index: true },
  items: { type: [ItemSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
  davUser: { type: String, default: null },
  davTokenHash: { type: String, default: null },
  davDisplayName: { type: String, default: null },
  davCreatedAt: { type: Date, default: null },
  davLastSeenAt: { type: Date, default: null },
  pendingMutations: { type: [MutationSchema], default: [] },
});

// One feed per (user, scope). listId null = the all-tasks feed. Replaces the old
// userId-unique index (one feed/user) — see reconcileCalendarFeedIndexes() which drops
// the legacy `userId_1` index at startup so multiple per-list feeds are allowed.
CalendarFeedSchema.index({ userId: 1, listId: 1 }, { unique: true });
// CalDAV Basic-Auth looks a feed up by its davUser; sparse-unique so only DAV-enabled
// feeds carry the constraint (null davUser rows are ignored).
CalendarFeedSchema.index({ davUser: 1 }, { unique: true, sparse: true });

const CalendarFeed = mongoose.model<ICalendarFeed>('CalendarFeed', CalendarFeedSchema);

/**
 * Migrate the calendarfeeds indexes in place: drop the legacy unique `userId_1` index
 * (which would block a second per-list feed for the same user) and ensure the new
 * compound unique index exists, plus the sparse-unique davUser index for CalDAV.
 * Idempotent + best-effort; safe to call on every boot. Needed because production
 * runs with autoIndex off.
 */
export const reconcileCalendarFeedIndexes = async (): Promise<void> => {
  try {
    const existing = await CalendarFeed.collection.indexes().catch(() => [] as any[]);
    if (Array.isArray(existing) && existing.some((i: any) => i.name === 'userId_1')) {
      await CalendarFeed.collection.dropIndex('userId_1').catch(() => {});
    }
    await CalendarFeed.collection.createIndex({ userId: 1, listId: 1 }, { unique: true }).catch(() => {});
    await CalendarFeed.collection.createIndex({ davUser: 1 }, { unique: true, sparse: true }).catch(() => {});
  } catch {
    /* best-effort — never block boot on index reconciliation */
  }
};

export default CalendarFeed;
