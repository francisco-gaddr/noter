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
  userId: { type: String, required: true, unique: true, index: true },
  token: { type: String, required: true, unique: true, index: true },
  items: { type: [ItemSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<ICalendarFeed>('CalendarFeed', CalendarFeedSchema);
