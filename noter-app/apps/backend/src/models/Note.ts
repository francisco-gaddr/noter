import mongoose, { Schema, Document } from 'mongoose';

export interface INote extends Document {
  userId: string;
  clientId?: string;
  title: string; // Encrypted
  content: string; // Encrypted
  tags: string[]; // Encrypted
  parentId?: mongoose.Types.ObjectId;
  locked: string; // Encrypted boolean as string
  password?: string;
  icon?: string; // Encrypted
  order?: number;
  type?: 'note' | 'task_list' | 'project'; // Encrypted
  createdAt: string; // Encrypted date as string
  updatedAt: string; // Encrypted date as string
}

const NoteSchema: Schema = new Schema({
  userId: { type: String, required: true, default: 'demo-user', index: true },
  clientId: { type: String, default: '' },
  title: { type: String, required: false, default: 'Untitled' }, // Encrypted
  content: { type: String, required: false, default: '' }, // Encrypted
  tags: { type: [String], default: [] }, // Encrypted
  parentId: { type: Schema.Types.ObjectId, ref: 'Note', default: null },
  locked: { type: String, default: 'false' }, // Encrypted boolean as string
  password: { type: String, select: false }, // Don't return by default
  icon: { type: String, default: null }, // Encrypted
  order: { type: Number, default: 0 },
  type: { type: String, default: 'note' }, // Encrypted
  createdAt: { type: String, default: '' }, // Encrypted
  updatedAt: { type: String, default: '' }, // Encrypted
}, {
  timestamps: false // We'll manage timestamps manually since they're encrypted
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
