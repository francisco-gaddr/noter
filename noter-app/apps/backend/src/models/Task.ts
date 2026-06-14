import mongoose, { Schema, Document } from 'mongoose';

export interface ITask extends Document {
  userId: string;
  clientId?: string;
  title: string;
  description: string;
  dueDate: string | null;
  completed: string;
  priority: string;
  parentNoteId: Schema.Types.ObjectId | null;
  parentId?: Schema.Types.ObjectId | null; // For subtasks
  position: string; // Encrypted position
  recurrenceType?: string;
  recurrenceDays?: string;
  reminderEnabled?: string;
  reminderOffsetMinutes?: string;
  createdAt: string; // Encrypted timestamp
  updatedAt: string; // Encrypted timestamp
}

const TaskSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  clientId: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  dueDate: { type: String, default: null }, // Encrypted date
  completed: { type: String, default: '' }, // Encrypted boolean
  priority: { type: String, default: '' }, // Encrypted priority
  parentNoteId: { type: Schema.Types.ObjectId, ref: 'Note', default: null },
  parentId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  position: { type: String, default: '' }, // Encrypted position
  recurrenceType: { type: String, default: '' },
  recurrenceDays: { type: String, default: '' },
  reminderEnabled: { type: String, default: '' },
  reminderOffsetMinutes: { type: String, default: '' },
  // Encrypted JSON of the AI delegation (assignee/source/model/runOnBackend/notify).
  // Encrypted with the service key (server-readable) so the backend agent runner
  // can execute it; only synced when the user opts a task into backend execution.
  aiAgent: { type: String, default: '' },
  createdAt: { type: String, default: '' }, // Encrypted timestamp
  updatedAt: { type: String, default: '' }, // Encrypted timestamp
}, {
  timestamps: false // We'll manage timestamps manually since they're encrypted
});

// Indexes for performance
TaskSchema.index({ userId: 1, parentNoteId: 1 });
TaskSchema.index({ userId: 1, completed: 1 });
TaskSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $ne: '' } } }
);

export default mongoose.model<ITask>('Task', TaskSchema);
