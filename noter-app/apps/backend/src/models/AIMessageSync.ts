import mongoose, { Schema, Document } from 'mongoose';

export interface IAIMessageSync extends Document {
  userId: string;
  conversationId: string;
  messageId: string;
  roleEnc: string;
  contentEnc: string;
  toolCallsEnc?: string;
  toolCallIdEnc?: string;
  createdAtEnc: string;
  createdAt: Date;
}

const AIMessageSyncSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  messageId: { type: String, required: true },
  roleEnc: { type: String, required: true },
  contentEnc: { type: String, required: true },
  toolCallsEnc: { type: String, default: '' },
  toolCallIdEnc: { type: String, default: '' },
  createdAtEnc: { type: String, required: true },
  createdAt: { type: Date, required: true, index: true },
}, {
  timestamps: false,
});

AIMessageSyncSchema.index({ userId: 1, messageId: 1 }, { unique: true });

export default mongoose.model<IAIMessageSync>('AIMessageSync', AIMessageSyncSchema);
