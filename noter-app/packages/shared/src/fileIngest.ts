/**
 * Pure ingestion planner: turn a flat list of external WebDAV entries (folders + files) into
 * a diff against the notes we already synced from that connection. Folders become project
 * notes (`type:'project'`), files become `type:'note'` with their extracted text, nested via
 * `parentId` — so once landed, the whole existing pipeline (buildIndexableEntities →
 * embeddings, buildGraph, two-stage RAG, lock guard, realtime) treats them as ordinary notes.
 *
 * IO-free and ES5-safe: the platform service fetches + extracts text + encrypts + persists;
 * this module only decides WHAT to create/update/delete. Identity is the `source` field
 * (origin + connectionId + remotePath); change detection is the remote ETag.
 */
import type { Note } from './types';

/** Provenance stamped on every note ingested from an external file source. */
export interface NoteSource {
  origin: 'nextcloud' | 'webdav';
  connectionId: string;
  /** Path relative to the connection root, POSIX (e.g. 'Research/x.pdf' or 'Research'). */
  remotePath: string;
  /** Remote ETag at last sync — re-ingest when it changes. Folders carry ''. */
  remoteEtag: string;
  remoteModified?: string;
  mimeType?: string;
  syncedAt?: string;
  /** Hash of the note body at last sync — used to detect LOCAL edits for the outbound push
   *  (two-way sync) without relying on timestamps. */
  contentHash?: string;
}

/** Minimal shape the planner needs from an already-synced note. */
export interface SyncedNoteRef {
  _id: string;
  parentId?: string | null;
  type?: 'note' | 'task_list' | 'project';
  source?: NoteSource | null;
}

/** A folder or file the platform should fetch + extract before creating/updating. */
export interface IngestEntry {
  path: string;
  name: string;
  isCollection: boolean;
  etag: string;
  mimeType: string;
  lastModified: string;
}

export interface IngestNoteDraft {
  /** Stable client id so create + later updates resolve to one note (path-derived). */
  clientKey: string;
  type: 'note' | 'project';
  title: string;
  /** Remote path of the parent folder, or null for a selected root. */
  parentRemotePath: string | null;
  source: NoteSource;
  /** Files only: the platform fills text after extraction; folders leave it ''. */
  needsContent: boolean;
}

export interface IngestPlan {
  /** New folders/files to create (folders first, ordered shallow→deep). */
  creates: IngestNoteDraft[];
  /** Existing notes whose remote ETag changed → re-extract + update. */
  updates: Array<IngestNoteDraft & { noteId: string }>;
  /** Note ids that vanished remotely (under the synced roots) → delete. */
  deletes: string[];
  /** Unchanged note ids (same ETag) — for stats only. */
  unchanged: string[];
}

const depthOf = (path: string): number => (path ? path.split('/').length : 0);

const parentPathOf = (path: string): string | null => {
  const i = (path || '').lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : null;
};

const clientKeyFor = (connectionId: string, remotePath: string): string =>
  'nc:' + connectionId + ':' + remotePath;

const isFromConnection = (n: SyncedNoteRef, connectionId: string): boolean =>
  !!n.source && n.source.origin !== undefined && n.source.connectionId === connectionId;

/**
 * Diff the freshly-listed remote entries against the notes already synced from this
 * connection. `entries` should already be scoped to the selected roots + allowlist-filtered
 * (skip-classified files removed) by the caller.
 */
export const planIngest = (
  entries: IngestEntry[],
  existing: SyncedNoteRef[],
  connectionId: string,
  syncedAt: string,
  // When set, this is a SCOPED (single-folder) sync: only enumerate/delete within this remotePath
  // subtree, so notes elsewhere in the connection are never touched (no accidental deletes).
  onlyUnderPath?: string,
): IngestPlan => {
  const byRemotePath = new Map<string, SyncedNoteRef>();
  for (const n of existing) {
    if (isFromConnection(n, connectionId) && n.source) byRemotePath.set(n.source.remotePath, n);
  }

  // Folders shallow→deep first so parents exist before children; then files.
  const ordered = entries.slice().sort((a, b) => {
    if (a.isCollection !== b.isCollection) return a.isCollection ? -1 : 1;
    return depthOf(a.path) - depthOf(b.path);
  });

  const creates: IngestNoteDraft[] = [];
  const updates: Array<IngestNoteDraft & { noteId: string }> = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const e of ordered) {
    seen.add(e.path);
    const draft: IngestNoteDraft = {
      clientKey: clientKeyFor(connectionId, e.path),
      type: e.isCollection ? 'project' : 'note',
      title: e.name,
      parentRemotePath: parentPathOf(e.path),
      needsContent: !e.isCollection,
      source: {
        origin: 'nextcloud',
        connectionId,
        remotePath: e.path,
        remoteEtag: e.etag || '',
        remoteModified: e.lastModified,
        mimeType: e.mimeType,
        syncedAt,
      },
    };
    const prev = byRemotePath.get(e.path);
    if (!prev) {
      creates.push(draft);
    } else if (e.isCollection) {
      unchanged.push(prev._id); // folders have no content to re-extract
    } else if ((prev.source && prev.source.remoteEtag) !== draft.source.remoteEtag) {
      updates.push(Object.assign({}, draft, { noteId: prev._id }));
    } else {
      unchanged.push(prev._id);
    }
  }

  // Anything we previously synced from this connection that's no longer present remotely.
  // In a scoped (single-folder) sync, only consider deletes WITHIN that subtree.
  const norm = (p: string) => p.replace(/^\/+|\/+$/g, '');
  const scopePrefix = onlyUnderPath ? norm(onlyUnderPath) : '';
  const isInScope = (p: string) => !scopePrefix || p === scopePrefix || norm(p).startsWith(scopePrefix + '/');
  const deletes: string[] = [];
  for (const n of existing) {
    if (isFromConnection(n, connectionId) && n.source && !seen.has(n.source.remotePath) && isInScope(n.source.remotePath)) {
      deletes.push(n._id);
    }
  }

  return { creates, updates, deletes, unchanged };
};

/** Build the provenance header prepended to ingested file text (mirrors aiAttachments). */
export const ingestProvenanceHeader = (source: NoteSource): string =>
  'Synkad fil: ' + source.remotePath +
  (source.mimeType ? ' (' + source.mimeType + ')' : '') +
  ' · källa: Nextcloud';

/** Read a note's source field tolerantly (it may arrive as a JSON string after decrypt). */
export const parseNoteSource = (raw: unknown): NoteSource | null => {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (!obj.connectionId || !obj.remotePath) return null;
  return {
    origin: obj.origin === 'webdav' ? 'webdav' : 'nextcloud',
    connectionId: String(obj.connectionId),
    remotePath: String(obj.remotePath),
    remoteEtag: String(obj.remoteEtag || ''),
    remoteModified: obj.remoteModified ? String(obj.remoteModified) : undefined,
    mimeType: obj.mimeType ? String(obj.mimeType) : undefined,
    syncedAt: obj.syncedAt ? String(obj.syncedAt) : undefined,
    contentHash: obj.contentHash ? String(obj.contentHash) : undefined,
  };
};

/** Narrow a full Note to the SyncedNoteRef the planner needs (decodes source if needed). */
export const toSyncedRef = (n: Note & { source?: unknown }): SyncedNoteRef => ({
  _id: n._id,
  parentId: n.parentId,
  type: n.type,
  source: parseNoteSource((n as any).source),
});

/** Normalize a WebDAV ETag for comparison: drop a weak-validator `W/` prefix + surrounding quotes. */
export const normalizeEtag = (etag: string | null | undefined): string =>
  (etag || '').trim().replace(/^W\//i, '').replace(/^"+|"+$/g, '');

/**
 * Optimistic-concurrency check for a two-way WebDAV push: has the remote file changed since we last
 * synced it? Compares the freshly-enumerated remote ETag against the ETag we recorded at the last
 * sync. Returns `false` when either side is unknown (no baseline to protect — e.g. a first upload or
 * a folder), so a legitimate push is never blocked. When it returns `true`, pushing the local edit
 * would silently clobber the remote change — the caller must skip the overwrite (lost-update
 * prevention; HTTP If-Match/412 semantics applied with already-fetched ETags, no extra request).
 */
export const remoteChangedSinceSync = (
  currentEtag: string | null | undefined,
  lastSyncedEtag: string | null | undefined,
): boolean => {
  const a = normalizeEtag(currentEtag);
  const b = normalizeEtag(lastSyncedEtag);
  if (!a || !b) return false;
  return a !== b;
};
