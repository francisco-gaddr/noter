import mongoose, { Schema, Document } from 'mongoose';

export interface IAIProjectSync extends Document {
  userId: string;
  projectId: string;
  nameEnc: string;
  systemPromptEnc?: string;
  iconEnc?: string;
  iconColorEnc?: string;
  createdAtEnc: string;
  updatedAtEnc: string;
  updatedAt: Date;
}

const AIProjectSyncSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  projectId: { type: String, required: true },
  nameEnc: { type: String, required: true },
  systemPromptEnc: { type: String, default: '' },
  iconEnc: { type: String, default: '' },
  iconColorEnc: { type: String, default: '' },
  createdAtEnc: { type: String, required: true },
  updatedAtEnc: { type: String, required: true },
  updatedAt: { type: Date, required: true, index: true },
}, {
  timestamps: false,
});

AIProjectSyncSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export default mongoose.model<IAIProjectSync>('AIProjectSync', AIProjectSyncSchema);
