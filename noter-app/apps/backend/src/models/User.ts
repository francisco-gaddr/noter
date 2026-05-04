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
  passwordHash: { type: String, required: true, select: false, minlength: 50, maxlength: 200 },
  tokenVersion: { type: Number, required: true, default: 1, min: 1 },
  encryptionSalt: {
    type: String,
    default: '',
    select: false,
    trim: true,
    maxlength: 1024,
    validate: {
      validator: (value: unknown) => {
        if (value === '' || value === undefined || value === null) return true;
        if (typeof value !== 'string') return false;
        return value.length >= 16 && value.length <= 1024;
      },
    },
  },
  wrappedDataKey: {
    type: String,
    default: '',
    select: false,
    trim: true,
    maxlength: 4096,
    validate: {
      validator: (value: unknown) => {
        if (value === '' || value === undefined || value === null) return true;
        if (typeof value !== 'string') return false;
        return value.length >= 24 && value.length <= 4096;
      },
    },
  },
  keyWrapVersion: { type: Number, default: 1, min: 1, max: 10 },
  keyWrapKdf: { type: String, default: 'pbkdf2-sha256', select: false, trim: true, enum: ['pbkdf2-sha256'] },
  keyWrappedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

export default (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>('User', UserSchema);
