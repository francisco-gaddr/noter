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
 */
export interface ICalendarItem {
  uid: string;
  title: string;
  start: string;   // ISO date/datetime
  allDay: boolean;
  completed?: boolean;
}

export interface ICalendarFeed extends Document {
  userId: string;
  /** Scope: null = all dated tasks; otherwise a task-list/project note id. */
  listId: string | null;
  token: string;
  items: ICalendarItem[];
  updatedAt: Date;
}

const ItemSchema = new Schema<ICalendarItem>({
  uid: { type: String, required: true },
  title: { type: String, default: '' },
  start: { type: String, required: true },
  allDay: { type: Boolean, default: true },
  completed: { type: Boolean, default: false },
}, { _id: false });

const CalendarFeedSchema = new Schema<ICalendarFeed>({
  userId: { type: String, required: true, index: true },
  listId: { type: String, default: null },
  token: { type: String, required: true, unique: true, index: true },
  items: { type: [ItemSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

// One feed per (user, scope). listId null = the all-tasks feed. Replaces the old
// userId-unique index (one feed/user) — see reconcileCalendarFeedIndexes() which drops
// the legacy `userId_1` index at startup so multiple per-list feeds are allowed.
CalendarFeedSchema.index({ userId: 1, listId: 1 }, { unique: true });

const CalendarFeed = mongoose.model<ICalendarFeed>('CalendarFeed', CalendarFeedSchema);

/**
 * Migrate the calendarfeeds indexes in place: drop the legacy unique `userId_1` index
 * (which would block a second per-list feed for the same user) and ensure the new
 * compound unique index exists. Idempotent + best-effort; safe to call on every boot.
 * Needed because production runs with autoIndex off.
 */
export const reconcileCalendarFeedIndexes = async (): Promise<void> => {
  try {
    const existing = await CalendarFeed.collection.indexes().catch(() => [] as any[]);
    if (Array.isArray(existing) && existing.some((i: any) => i.name === 'userId_1')) {
      await CalendarFeed.collection.dropIndex('userId_1').catch(() => {});
    }
    await CalendarFeed.collection.createIndex({ userId: 1, listId: 1 }, { unique: true }).catch(() => {});
  } catch {
    /* best-effort — never block boot on index reconciliation */
  }
};

export default CalendarFeed;
