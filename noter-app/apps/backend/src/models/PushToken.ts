import mongoose, { Schema, Document } from 'mongoose';

/**
 * An Expo push token for one of a user's devices. The backend sends push
 * notifications (e.g. "AI-agenten startade/avslutade en uppgift") to every token
 * the user has registered, so notices reach all their devices. Tokens are not
 * secret, but are still scoped per user and only readable by that account.
 */
export interface IPushToken extends Document {
  userId: string;
  token: string; // ExponentPushToken[...]
  platform: string; // ios | android | web
  updatedAt: string;
}

const PushTokenSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, default: '' },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});

export default mongoose.model<IPushToken>('PushToken', PushTokenSchema);
