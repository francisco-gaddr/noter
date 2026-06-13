import mongoose, { Schema, Document } from 'mongoose';

/**
 * Opaque end-to-end key bundle. The server stores but NEVER interprets these
 * values — `wrappedDataKey` is the user's dataKey sealed under a password-derived
 * root key (see packages/shared/cryptoV3). Without the user's password the server
 * cannot derive the root key, so it can never unwrap the dataKey or read content.
 */
export interface IKeyBundle {
  wrappedDataKey: string; // `v3w:` envelope
  kdfSalt: string; // base64
  kdf: string; // 'argon2id' | 'pbkdf2-sha256'
  keyVersion: number;
  updatedAt: Date;
  // Optional recovery wrap (a second copy of the dataKey under a recovery code).
  recoveryWrappedDataKey?: string;
  recoverySalt?: string;
  recoveryKdf?: string;
}

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  createdAt: Date;
  keyBundle?: IKeyBundle;
}

const KeyBundleSchema = new Schema<IKeyBundle>(
  {
    wrappedDataKey: { type: String, required: true, maxlength: 1024 },
    kdfSalt: { type: String, required: true, maxlength: 256 },
    kdf: { type: String, required: true, enum: ['argon2id', 'pbkdf2-sha256'] },
    keyVersion: { type: Number, required: true, min: 1, max: 1_000_000 },
    updatedAt: { type: Date, default: Date.now },
    recoveryWrappedDataKey: { type: String, required: false, maxlength: 1024 },
    recoverySalt: { type: String, required: false, maxlength: 256 },
    recoveryKdf: { type: String, required: false, enum: ['argon2id', 'pbkdf2-sha256'] },
  },
  { _id: false },
);

const UserSchema: Schema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  // Optional: only present once the user has enrolled in v3 E2E encryption.
  keyBundle: { type: KeyBundleSchema, required: false },
});

export default mongoose.model<IUser>('User', UserSchema);
