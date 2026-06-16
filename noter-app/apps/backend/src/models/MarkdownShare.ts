import mongoose, { Schema, Document } from 'mongoose';

/**
 * External Markdown SHARE — the note/files twin of CalendarFeed.
 *
 * A share exposes a USER-SELECTED set of notes and/or project-folders as a Markdown
 * vault that external tools (Obsidian, Finder, Android, widgets) can read/write over
 * WebDAV (Phase 1) and, when `modes.crdt` is on, edit live via the CRDT server (Phase 2).
 *
 * Note titles/bodies are END-TO-END ENCRYPTED at rest — the server can't read them. The
 * client pushes a minimal, lock-aware plaintext **projection** (`files`) of the selected
 * notes; the WebDAV server serves those as `.md` files. Inbound external edits that can't
 * touch ciphertext are recorded as `pendingMutations` for the client to apply with the
 * user's key, then re-push. See markdav/server.ts + routes/markdownShares.ts +
 * Doc/external-markdown-sync.md.
 */

export interface IMarkdownFile {
  path: string;          // POSIX, slugged, unique within the vault (e.g. "Work/Note.md")
  noteId: string;        // stable join key
  title: string;
  body: string;          // markdown content (frontmatter is rendered on the fly)
  tags?: string[];
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  etag: string;          // weak change token
}

export interface IMarkdownMutation {
  id: string;
  op: 'upsert' | 'delete' | 'move';
  path: string;
  destination?: string | null; // for MOVE/rename
  /** New file body for an upsert (non-sensitive: lives only in this opted-in share). */
  body?: string | null;
  at: Date;
}

export interface IMarkdownShare extends Document {
  userId: string;
  shareId: string;
  name: string;
  /** Project-folder note ids whose descendants are all shared. */
  folderIds: string[];
  /** Individually-shared note ids. */
  noteIds: string[];
  files: IMarkdownFile[];
  /** Which transports are exposed for this share. */
  modes: { webdav: boolean; crdt: boolean };
  /** Which directions are allowed (outbound = app→external reads; inbound = external→app writes). */
  direction: { outbound: boolean; inbound: boolean };
  davUser?: string | null;
  davTokenHash?: string | null;
  davCreatedAt?: Date | null;
  davLastSeenAt?: Date | null;
  /** CRDT (Phase 2) per-share auth token hash — null until Live mode is enabled. */
  crdtTokenHash?: string | null;
  pendingMutations: IMarkdownMutation[];
  updatedAt: Date;
}

const FileSchema = new Schema<IMarkdownFile>({
  path: { type: String, required: true },
  noteId: { type: String, required: true },
  title: { type: String, default: '' },
  body: { type: String, default: '' },
  tags: { type: [String], default: [] },
  type: { type: String, default: 'note' },
  createdAt: { type: String, default: '' },
  updatedAt: { type: String, default: '' },
  etag: { type: String, default: '' },
}, { _id: false });

const MutationSchema = new Schema<IMarkdownMutation>({
  id: { type: String, required: true },
  op: { type: String, enum: ['upsert', 'delete', 'move'], required: true },
  path: { type: String, required: true },
  destination: { type: String, default: null },
  body: { type: String, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const MarkdownShareSchema = new Schema<IMarkdownShare>({
  userId: { type: String, required: true, index: true },
  shareId: { type: String, required: true },
  name: { type: String, default: '' },
  folderIds: { type: [String], default: [] },
  noteIds: { type: [String], default: [] },
  files: { type: [FileSchema], default: [] },
  modes: {
    webdav: { type: Boolean, default: true },
    crdt: { type: Boolean, default: false },
  },
  direction: {
    outbound: { type: Boolean, default: true },
    inbound: { type: Boolean, default: true },
  },
  davUser: { type: String, default: null },
  davTokenHash: { type: String, default: null },
  davCreatedAt: { type: Date, default: null },
  davLastSeenAt: { type: Date, default: null },
  crdtTokenHash: { type: String, default: null },
  pendingMutations: { type: [MutationSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

MarkdownShareSchema.index({ userId: 1, shareId: 1 }, { unique: true });
MarkdownShareSchema.index(
  { davUser: 1 },
  { unique: true, partialFilterExpression: { davUser: { $type: 'string' } } },
);

const MarkdownShare = mongoose.model<IMarkdownShare>('MarkdownShare', MarkdownShareSchema);

/** Ensure indexes at boot (prod runs autoIndex off). Idempotent, best-effort. */
export const reconcileMarkdownShareIndexes = async (): Promise<void> => {
  try {
    await MarkdownShare.collection.createIndex({ userId: 1, shareId: 1 }, { unique: true }).catch(() => {});
    await MarkdownShare.collection
      .createIndex({ davUser: 1 }, { unique: true, partialFilterExpression: { davUser: { $type: 'string' } } })
      .catch(() => {});
  } catch {
    /* never block boot */
  }
};

export default MarkdownShare;
