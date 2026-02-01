import mongoose, { Schema, Document } from 'mongoose';

export interface INote extends Document {
  userId: string;
  clientId?: string;
  title: string;
  content: string;
  tags: string[];
  parentId?: mongoose.Types.ObjectId;
  locked: boolean;
  password?: string;
  icon?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema: Schema = new Schema({
  userId: { type: String, required: true, default: 'demo-user', index: true },
  clientId: { type: String, default: '' },
  title: { type: String, required: false, default: 'Untitled' },
  content: { type: String, required: false, default: '' }, // Encrypted content will be stored here later
  tags: { type: [String], default: [] },
  parentId: { type: Schema.Types.ObjectId, ref: 'Note', default: null },
  locked: { type: Boolean, default: false },
  password: { type: String, select: false }, // Don't return by default
  icon: { type: String, default: null },
  order: { type: Number, default: 0 },
  type: { type: String, default: 'note' },
}, {
  timestamps: true
});

// Index for performance
NoteSchema.index({ createdAt: -1 });
NoteSchema.index({ userId: 1, parentId: 1 });
NoteSchema.index({ userId: 1, type: 1 });
NoteSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $ne: '' } } }
);

export default mongoose.model<INote>('Note', NoteSchema);
