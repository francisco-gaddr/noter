import mongoose, { Schema, Document } from 'mongoose';

export interface IAIConversationSync extends Document {
  userId: string;
  conversationId: string;
  titleEnc: string;
  modelEnc?: string;
  projectIdEnc?: string;
  iconEnc?: string;
  iconColorEnc?: string;
  createdAtEnc: string;
  updatedAtEnc: string;
  updatedAt: Date;
}

const AIConversationSyncSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true },
  titleEnc: { type: String, required: true },
  modelEnc: { type: String, default: '' },
  projectIdEnc: { type: String, default: '' },
  iconEnc: { type: String, default: '' },
  iconColorEnc: { type: String, default: '' },
  createdAtEnc: { type: String, required: true },
  updatedAtEnc: { type: String, required: true },
  updatedAt: { type: Date, required: true, index: true },
}, {
  timestamps: false,
});

AIConversationSyncSchema.index({ userId: 1, conversationId: 1 }, { unique: true });

export default mongoose.model<IAIConversationSync>('AIConversationSync', AIConversationSyncSchema);
