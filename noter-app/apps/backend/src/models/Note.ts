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
  links?: string; // Encrypted JSON array of {targetId, rel}
  source?: string; // Encrypted JSON provenance for externally-ingested notes (NoteSource)
  // Per-folder crypto bundle (ADR-0012) for a cryptographically-protected project folder. Opaque to
  // the zero-knowledge server: it is a serialized FolderKeyBundle (salt + kdf + the folder key
  // wrapped under the folder password) — NOT a user-content ciphertext — and holds no secret usable
  // without the folder password. The server never inspects/decrypts it; it only stores + returns it.
  folderKeyBundle?: string;
  icon?: string; // Encrypted
  order?: string;
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
  links: { type: String, default: '' }, // Encrypted JSON array of {targetId, rel}
  source: { type: String, default: '' }, // Encrypted JSON provenance (NoteSource) — externally-ingested notes
  folderKeyBundle: { type: String, default: '' }, // Serialized FolderKeyBundle (ADR-0012); opaque, never decrypted server-side
  icon: { type: String, default: null }, // Encrypted
  order: { type: String, default: '' },
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
