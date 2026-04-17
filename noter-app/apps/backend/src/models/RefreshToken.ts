import mongoose, { Schema, Document } from 'mongoose';

export interface IRefreshToken extends Document {
  userId: string;
  familyId: string;
  tokenHash: string;
  userAgentHash: string;
  ipHash: string;
  replacedByTokenHash?: string | null;
  revokedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const RefreshTokenSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  userAgentHash: { type: String, default: '' },
  ipHash: { type: String, default: '' },
  replacedByTokenHash: { type: String, default: null },
  revokedAt: { type: Date, default: null, index: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
