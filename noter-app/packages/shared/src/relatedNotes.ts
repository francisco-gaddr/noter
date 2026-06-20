import type { Note, Task } from './types';
import type { VectorIndex } from './vectorStore';
import { indexToEmbeddedItems, buildIndexableEntities } from './vectorStore';
import { vectorSearch } from './vectorSearch';
import { AI_INDEX_NO_UNLOCK } from './locks';

/**
 * "Related notes" — surface the notes/tasks most semantically similar to the one the user is viewing.
 *
 * Smart reuse: the current note's embedding is ALREADY in the local index, so we cosine-search it
 * against the other stored vectors — ZERO embedding cost, fully on-device, no AI/network call.
 *
 * LOCK-SAFETY (hard invariant): locked notes must never surface to an AI/derived feature. We re-filter
 * candidates through `buildIndexableEntities(..., AI_INDEX_NO_UNLOCK)` against the CURRENT lock state —
 * the index can still hold a stale vector for a note that was locked since the last re-index, so the
 * index alone is not sufficient. If the current note itself isn't AI-readable, we return nothing.
 *
 * Pure → unit-tested in isolation; reused identically by web and mobile.
 */
export interface RelatedNote {
  id: string;
  title: string;
  kind: string;
  /** Cosine similarity in [0, 1]. */
  score: number;
  snippet?: string;
}

export const relatedNotes = (
  index: VectorIndex,
  noteId: string,
  notes: Note[],
  tasks: Task[],
  limit = 5,
): RelatedNote[] => {
  const items = indexToEmbeddedItems(index);
  const self = items.find((i) => i.id === noteId);
  if (!self?.vector?.length) return []; // the current note isn't embedded yet — nothing to compare

  // Readable set under the CURRENT lock state (AI never unlocks). Re-filtering here is what makes a
  // since-locked note disappear even if its vector still lingers in the index.
  const readable = new Set(buildIndexableEntities(notes, tasks, AI_INDEX_NO_UNLOCK as Set<string>).map((e) => e.id));
  if (!readable.has(noteId)) return []; // current note isn't AI-readable → don't derive from it

  const candidates = items.filter((i) => i.id !== noteId && readable.has(i.id));
  return vectorSearch(self.vector, candidates, limit).map((h) => ({
    id: h.id,
    title: h.title,
    kind: h.kind,
    score: h.score,
    snippet: h.snippet,
  }));
};
