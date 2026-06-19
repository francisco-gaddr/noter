/**
 * Vector + hybrid (RRF) search — the math for semantic retrieval, fused with the
 * existing fast fulltext rung (graphModel.fulltextSearch). Pure + dependency-free
 * (cosine over in-memory vectors is the right, modern, lightweight approach for a
 * personal client-side dataset — no vector-DB engine needed), so it runs identically
 * on mobile + Electron and is fully unit-tested.
 *
 * Embeddings are produced by a configurable model (on-device / Pi-Ollama / API — see
 * embeddingsConfig) and stored ENCRYPTED next to each entity; this module never sees
 * plaintext content, only the resulting vectors + the query vector.
 *
 * RRF (Reciprocal Rank Fusion) with k=60 is the industry-standard fuser for combining
 * heterogeneous rankings (dense + sparse) — robust, parameter-light, and what
 * OpenSearch / Azure AI Search / Chroma use by default.
 */
import type { SearchHit, SearchEntityKind } from './graphModel';

export interface EmbeddedItem {
  id: string;
  kind: SearchEntityKind;
  title: string;
  vector: number[];
  snippet?: string;
}

export interface VectorHit {
  id: string;
  kind: SearchEntityKind;
  title: string;
  score: number; // cosine similarity in [-1, 1]
  snippet?: string;
}

/**
 * Cosine similarity of two vectors. 0 when either is empty/zero, AND 0 when the dimensions
 * DIFFER. A dimension mismatch means the vectors came from different embedding models (e.g. after
 * the user switches model/provider before the index is rebuilt) — their coordinate spaces are
 * incompatible, so comparing them is meaningless. Truncating to the shorter length (the old
 * behaviour) produced GARBAGE scores; returning 0 instead makes a stale/incompatible vector score
 * nothing, so search degrades cleanly to the lexical rung until the index is re-embedded.
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

/** Rank items by cosine similarity to the query vector; top `limit`, score-desc. */
export const vectorSearch = (queryVector: number[], items: EmbeddedItem[], limit = 20): VectorHit[] => {
  if (!queryVector || queryVector.length === 0) return [];
  const hits: VectorHit[] = [];
  for (const it of items || []) {
    if (!it?.vector?.length) continue;
    const score = cosineSimilarity(queryVector, it.vector);
    if (score > 0) hits.push({ id: it.id, kind: it.kind, title: it.title, score, snippet: it.snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

export interface RankedList { id: string }

/**
 * Reciprocal Rank Fusion: merge several ranked id-lists into one id→score map.
 * score(id) = Σ over lists of 1 / (k + rank), rank 1-based. k=60 (standard).
 */
export const reciprocalRankFusion = <T extends RankedList>(lists: T[][], k = 60): Map<string, number> => {
  const fused = new Map<string, number>();
  for (const list of lists || []) {
    list.forEach((item, idx) => {
      const rank = idx + 1;
      fused.set(item.id, (fused.get(item.id) || 0) + 1 / (k + rank));
    });
  }
  return fused;
};

export interface HybridHit {
  id: string;
  kind: SearchEntityKind;
  title: string;
  snippet?: string;
  rrfScore: number;
  inFulltext: boolean;
  inVector: boolean;
}

/**
 * Hybrid search: fuse a fulltext ranking (sparse) and a vector ranking (dense) with
 * RRF, returning the merged, re-ranked hits. Either list may be empty (graceful
 * degradation to whichever rung is available).
 */
export const hybridSearch = (
  fulltext: SearchHit[],
  vector: VectorHit[],
  limit = 20,
  k = 60,
): HybridHit[] => {
  const fused = reciprocalRankFusion<{ id: string }>([fulltext, vector], k);
  const ftIds = new Set(fulltext.map((h) => h.id));
  const vIds = new Set(vector.map((h) => h.id));
  const meta = new Map<string, { kind: SearchEntityKind; title: string; snippet?: string }>();
  for (const h of vector) meta.set(h.id, { kind: h.kind, title: h.title, snippet: h.snippet });
  for (const h of fulltext) meta.set(h.id, { kind: h.kind, title: h.title, snippet: h.snippet }); // fulltext wins for snippet
  const rows: HybridHit[] = [];
  fused.forEach((rrfScore, id) => {
    const m = meta.get(id);
    if (!m) return;
    rows.push({ id, kind: m.kind, title: m.title, snippet: m.snippet, rrfScore, inFulltext: ftIds.has(id), inVector: vIds.has(id) });
  });
  return rows.sort((a, b) => b.rrfScore - a.rrfScore).slice(0, limit);
};
