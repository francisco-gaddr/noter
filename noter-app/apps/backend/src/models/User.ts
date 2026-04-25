import mongoose, { Schema } from 'mongoose';

export interface IUser {
  username: string;
  passwordHash: string;
  tokenVersion: number;
  encryptionSalt?: string;
  wrappedDataKey?: string;
  keyWrapVersion?: number;
  keyWrapKdf?: string;
  keyWrappedAt?: Date | null;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true, select: false },
  tokenVersion: { type: Number, required: true, default: 1 },
  encryptionSalt: { type: String, default: '', select: false },
  wrappedDataKey: { type: String, default: '', select: false },
  keyWrapVersion: { type: Number, default: 1 },
  keyWrapKdf: { type: String, default: 'pbkdf2-sha256', select: false },
  keyWrappedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

export default (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>('User', UserSchema);
