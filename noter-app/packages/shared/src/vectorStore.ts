/**
 * Vector index bookkeeping — the pure logic for an encrypted, on-device embedding
 * index. Decides which entities need (re)embedding by comparing a stable content
 * hash + the model id, drops stale entries, and projects stored rows into the
 * EmbeddedItem shape the vector search consumes. Storage (encrypt → localStorage /
 * AsyncStorage) lives in each platform's service; this module is pure + unit-tested.
 *
 * Locked notes/locked-project descendants must be filtered out BEFORE they reach
 * here — the index never holds content the AI/search isn't allowed to read.
 */
import { embeddingText, embeddingContentHash } from './embeddings';
import type { EmbeddedItem } from './vectorSearch';
import type { SearchEntityKind } from './graphModel';
import type { Note, Task } from './types';
import { buildSecurityNoteMap, isReadableWithLocks } from './locks';
import { normalizeNoteType } from './noteType';

/** A decrypted entity the caller wants searchable. */
export interface IndexableEntity {
  id: string;
  kind: SearchEntityKind;
  title: string;
  body: string;
}

/** A persisted embedding row (stored encrypted). */
export interface StoredVector {
  id: string;
  kind: SearchEntityKind;
  title: string;
  snippet?: string;
  vector: number[];
  /** Content hash at embed time — re-embed when it changes. */
  hash: string;
  /** Model used — re-embed everything when the user switches models. */
  model: string;
}

export interface VectorIndex {
  model: string;
  items: StoredVector[];
}

export const emptyVectorIndex = (model: string): VectorIndex => ({ model, items: [] });

/** Stable hash of an entity's embedding text — the staleness key. */
export const entitySignature = (e: IndexableEntity): string =>
  embeddingContentHash(embeddingText(e.title || '', e.body || ''));

export interface IndexDiff {
  /** Entities needing a fresh embedding (new or content/model changed). */
  toEmbed: IndexableEntity[];
  /** Existing rows that are still valid and can be kept as-is. */
  keep: StoredVector[];
  /** Number of stored rows dropped because their entity no longer exists. */
  removed: number;
}

/**
 * Diff the live entity set against the stored index for a target model. An entity is
 * re-embedded when it's new, its content hash changed, or the index's model differs
 * from the target model. Rows whose entity vanished are dropped.
 */
export const diffIndex = (entities: IndexableEntity[], stored: VectorIndex, model: string): IndexDiff => {
  const byId = new Map<string, StoredVector>();
  stored.items.forEach((row) => byId.set(row.id, row));
  const liveIds = new Set<string>();
  const toEmbed: IndexableEntity[] = [];
  const keep: StoredVector[] = [];

  for (const e of entities || []) {
    if (!e?.id) continue;
    liveIds.add(e.id);
    const sig = entitySignature(e);
    const prev = byId.get(e.id);
    if (prev && prev.hash === sig && prev.model === model && prev.vector.length > 0) {
      keep.push({ ...prev, title: e.title || prev.title, kind: e.kind });
    } else {
      toEmbed.push(e);
    }
  }

  const removed = stored.items.filter((row) => !liveIds.has(row.id)).length;
  return { toEmbed, keep, removed };
};

/** Build a stored row from an entity + its freshly computed vector. */
export const makeStoredVector = (e: IndexableEntity, vector: number[], model: string): StoredVector => ({
  id: e.id,
  kind: e.kind,
  title: (e.title || '').trim() || '(namnlös)',
  snippet: (e.body || '').slice(0, 120),
  vector,
  hash: entitySignature(e),
  model,
});

/** Project a stored index into the EmbeddedItem[] the vector search consumes. */
export const indexToEmbeddedItems = (index: VectorIndex): EmbeddedItem[] =>
  index.items
    .filter((row) => row.vector.length > 0)
    .map((row) => ({ id: row.id, kind: row.kind, title: row.title, vector: row.vector, snippet: row.snippet }));

export interface IndexStats {
  total: number;
  model: string;
  /** ids present so callers can detect coverage. */
  ids: string[];
}

export const indexStats = (index: VectorIndex): IndexStats => ({
  total: index.items.length,
  model: index.model,
  ids: index.items.map((r) => r.id),
});

const isDeleted = (v: unknown): boolean => v === true || v === 'true';

/**
 * Build the indexable entity set from decrypted notes + tasks, ENFORCING the lock guard:
 * locked notes and anything under a locked (and not-unlocked) project are excluded, and
 * tasks whose parent note is unreadable are excluded too. This is the single security
 * gate before content reaches the embedding index — the index must never hold content
 * the AI/search isn't allowed to read. Deleted items are skipped.
 */
export const buildIndexableEntities = (
  notes: Note[],
  tasks: Task[],
  unlockedIds: Set<string> = new Set(),
): IndexableEntity[] => {
  const noteMap = buildSecurityNoteMap(notes || []);
  const out: IndexableEntity[] = [];
  const readableNoteIds = new Set<string>();

  for (const n of notes || []) {
    if (isDeleted(n.deleted)) continue;
    if (!isReadableWithLocks(n, noteMap, unlockedIds)) continue;
    readableNoteIds.add(n._id);
    const kind = (normalizeNoteType(n.type) as SearchEntityKind) || 'note';
    out.push({ id: n._id, kind, title: n.title || '', body: n.content || '' });
  }

  for (const t of tasks || []) {
    if (isDeleted(t.deleted)) continue;
    // A task is readable only if it has no parent note, or its parent note is readable.
    const parentId = t.parentNoteId ? String(t.parentNoteId) : '';
    if (parentId && noteMap.has(parentId) && !readableNoteIds.has(parentId)) continue;
    out.push({ id: t._id, kind: 'task', title: t.title || '', body: t.description || '' });
  }

  return out;
};
