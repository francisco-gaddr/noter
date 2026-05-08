import mongoose, { Schema, Document } from 'mongoose';

export interface IDeletionTombstone extends Document {
  userId: string;
  entity: 'NOTE' | 'TASK';
  itemId: string;
  parentNoteId?: string | null;
  deletedAt: Date;
}

const DeletionTombstoneSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  entity: { type: String, enum: ['NOTE', 'TASK'], required: true, index: true },
  itemId: { type: String, required: true },
  parentNoteId: { type: String, default: null },
  deletedAt: { type: Date, required: true, default: Date.now, index: true },
}, {
  timestamps: false,
});

DeletionTombstoneSchema.index({ userId: 1, entity: 1, deletedAt: -1 });
DeletionTombstoneSchema.index({ userId: 1, entity: 1, itemId: 1 }, { unique: true });

export default mongoose.model<IDeletionTombstone>('DeletionTombstone', DeletionTombstoneSchema);
