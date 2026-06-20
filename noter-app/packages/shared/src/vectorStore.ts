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
  /** Epoch-ms this row was embedded. Drives newest-wins eviction when the index is capped. */
  at?: number;
}

export interface VectorIndex {
  model: string;
  /** Embedding SOURCE/provider (local | hermes | api). The vector space is defined by the
   *  model AND who served it — re-embed when EITHER changes (industry practice: store
   *  provider + model + dimension as index metadata). */
  provider?: string;
  /** Embedding dimension (from the first stored vector). Lets a reader detect a stale index
   *  whose vectors don't match the current model's output dim, without scanning every row. */
  dims?: number;
  items: StoredVector[];
}

/** Default ceiling on stored vectors. Caps on-device storage (≈3 KB/row) so the encrypted index
 *  can't overflow localStorage/AsyncStorage quota and lose the WHOLE index; oldest rows evict
 *  first (they keep lexical search). Generous — most users never hit it. */
export const DEFAULT_MAX_INDEX_ITEMS = 4000;

export const emptyVectorIndex = (model: string, provider?: string): VectorIndex => ({ model, provider, items: [] });

/**
 * Structural validity of a loaded/stored vector index. Used to (a) tell a CORRUPT blob apart from a
 * genuinely-absent index on read (so a decrypt failure isn't silently treated as "no index", which
 * would trigger a needless full re-embed), and (b) REFUSE to persist a malformed index over a good
 * one (so a bad in-memory value can't silently overwrite the on-disk cache).
 */
export const isValidVectorIndex = (x: unknown): x is VectorIndex =>
  !!x && typeof x === 'object'
  && typeof (x as VectorIndex).model === 'string'
  && Array.isArray((x as VectorIndex).items);

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
 * Diff the live entity set against the stored index for a target model + provider. An entity is
 * re-embedded when it's new, its content hash changed, or the index's model OR provider differs
 * from the target (a same-named model served by a different provider is a DIFFERENT vector space,
 * so its vectors would score as garbage — re-embed). Rows whose entity vanished are dropped.
 */
export const diffIndex = (
  entities: IndexableEntity[],
  stored: VectorIndex,
  model: string,
  provider?: string,
): IndexDiff => {
  const byId = new Map<string, StoredVector>();
  stored.items.forEach((row) => byId.set(row.id, row));
  const liveIds = new Set<string>();
  const toEmbed: IndexableEntity[] = [];
  const keep: StoredVector[] = [];
  // A provider change invalidates EVERY row (the stored vectors came from a different embedder).
  const providerChanged = provider !== undefined && (stored.provider ?? '') !== provider;

  for (const e of entities || []) {
    if (!e?.id) continue;
    liveIds.add(e.id);
    const sig = entitySignature(e);
    const prev = byId.get(e.id);
    if (prev && prev.hash === sig && prev.model === model && !providerChanged && prev.vector.length > 0) {
      keep.push({ ...prev, title: e.title || prev.title, kind: e.kind });
    } else {
      toEmbed.push(e);
    }
  }

  const removed = stored.items.filter((row) => !liveIds.has(row.id)).length;
  return { toEmbed, keep, removed };
};

/** Build a stored row from an entity + its freshly computed vector. Stamps the embed time. */
export const makeStoredVector = (e: IndexableEntity, vector: number[], model: string): StoredVector => ({
  id: e.id,
  kind: e.kind,
  title: (e.title || '').trim() || '(namnlös)',
  snippet: (e.body || '').slice(0, 120),
  vector,
  hash: entitySignature(e),
  model,
  at: Date.now(),
});

/**
 * Assemble the persisted index from the merged rows, stamping provider + dimension metadata and
 * enforcing the size cap. When over `maxItems`, the NEWEST-embedded rows are kept (most-recently
 * touched notes are the most relevant; evicted notes still have lexical search). Pure + testable.
 */
export const buildVectorIndex = (
  model: string,
  provider: string | undefined,
  items: StoredVector[],
  maxItems: number = DEFAULT_MAX_INDEX_ITEMS,
): VectorIndex => {
  let rows = items;
  if (maxItems > 0 && rows.length > maxItems) {
    rows = [...rows].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, maxItems);
  }
  const dims = rows.find((r) => r.vector.length > 0)?.vector.length;
  return { model, provider, dims, items: rows };
};

/**
 * Does the stored index need a full rebuild for the current embedder? True when the model or
 * provider differs (the stored vectors are from a different embedding space). Lets the UI surface
 * "re-index recommended" without re-embedding to find out.
 */
export const vectorIndexNeedsRebuild = (index: VectorIndex, model: string, provider?: string): boolean =>
  index.model !== model || (provider !== undefined && (index.provider ?? '') !== provider);

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
