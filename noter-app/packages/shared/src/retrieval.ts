/**
 * Retrieval pipeline — the "true RAG" orchestration that turns a user query into a
 * ranked set of context items for the AI chat. Implements the 2026 production-standard
 * TWO-STAGE pattern:
 *
 *   Stage 1 — broad recall (high recall):
 *     • lexical (sparse) ranking over title+text
 *     • dense (vector) ranking via cosine over embeddings (when a query vector + indexed
 *       candidate vectors exist)
 *     • GraphRAG expansion (optional): pull graph NEIGHBOURS of the top hits so related
 *       notes/tasks come along even if they don't match the query lexically/semantically
 *     → fused with Reciprocal Rank Fusion (RRF, k=60) into one candidate pool
 *
 *   Stage 2 — precise rerank (high precision):
 *     • a query-aware feature reranker re-scores the pool (term coverage, title hits,
 *       exact-phrase, density) and reorders the top-N. Reranking is the single most
 *       impactful RAG component; this is a dependency-free on-device reranker (a real
 *       cross-encoder / Cohere-rerank can be plugged in later behind the same interface).
 *
 * PURE + dependency-light so it runs identically on mobile + Electron and is fully
 * unit-tested. SECURITY: callers pass only already-readable candidates (locked notes are
 * filtered out upstream by buildIndexableEntities / isReadableWithLocks) — this module
 * never sees locked content and never bypasses that filter.
 */
import { cosineSimilarity, reciprocalRankFusion } from './vectorSearch';

export type RetrievalKind = 'note' | 'project' | 'task_list' | 'task';

export interface RetrievalCandidate {
  id: string;
  kind: RetrievalKind;
  title: string;
  /** Readable body / description (plaintext — never locked content). */
  text: string;
  /** Embedding for dense retrieval, if the item is indexed. */
  vector?: number[];
}

export interface RetrievalOptions {
  /** Lexical (sparse) recall. Default true. */
  useFulltext?: boolean;
  /** Dense (vector) recall — needs a query vector + candidate vectors. Default true. */
  useVector?: boolean;
  /** GraphRAG: expand the top hits with their graph neighbours. Default false. */
  useGraphExpansion?: boolean;
  /** Stage-2 query-aware rerank. Default true. */
  useRerank?: boolean;
  /** Final number of items returned. Default 8. */
  limit?: number;
  /** Stage-1 pool size before rerank. Default 50. */
  candidatePool?: number;
  /** RRF constant. Default 60 (industry standard). */
  rrfK?: number;
}

export interface RetrievedItem {
  id: string;
  kind: RetrievalKind;
  title: string;
  text: string;
  /** Final ranking score (rerank score when reranking, else fused RRF score). */
  score: number;
  /** Which rungs surfaced this item (provenance, for transparency/debug). */
  via: Array<'fulltext' | 'vector' | 'graph'>;
}

// Lowercase word tokens. No `u`/`\p{}` (shared targets ES5) — include common Swedish +
// accented letters explicitly so "anteckning", "café", "Åsa" tokenise sensibly.
const tokenize = (s: string): string[] =>
  (s || '').toLowerCase().split(/[^0-9a-zåäöéèëêùúûüíìîïóòôçñ]+/i).filter(Boolean);

const uniq = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

/** Count occurrences of a token in a token list. */
const countIn = (tokens: string[], term: string): number => {
  let n = 0;
  for (const t of tokens) if (t === term) n += 1;
  return n;
};

/**
 * Lexical relevance of a candidate to the query (sparse/BM25-ish, dependency-free):
 * title hits weigh 3×, body 1×, with a small length normalisation so very long notes
 * don't dominate. 0 when nothing matches.
 */
const lexicalScore = (queryTerms: string[], cand: RetrievalCandidate): number => {
  if (queryTerms.length === 0) return 0;
  const titleTokens = tokenize(cand.title);
  const bodyTokens = tokenize(cand.text);
  let score = 0;
  for (const term of queryTerms) {
    score += countIn(titleTokens, term) * 3;
    score += countIn(bodyTokens, term);
  }
  // Length normalisation (favour focused matches over sprawling docs).
  const norm = 1 + Math.log10(1 + bodyTokens.length);
  return score / norm;
};

/**
 * Stage-2 reranker score: query-aware precision features over the FULL text.
 *  - coverage: fraction of DISTINCT query terms present (the strongest signal)
 *  - title coverage: distinct query terms in the title
 *  - exact phrase: the full query string appears verbatim (title or body)
 *  - density: term hits per 100 tokens (concentration)
 * Returns a score in roughly [0, ~5]; higher = more relevant.
 */
const rerankScore = (query: string, queryTerms: string[], cand: RetrievalCandidate): number => {
  if (queryTerms.length === 0) return 0;
  const distinct = uniq(queryTerms);
  const titleTokens = tokenize(cand.title);
  const bodyTokens = tokenize(cand.text);
  const allTokens = titleTokens.concat(bodyTokens);
  const present = new Set(allTokens);
  const titlePresent = new Set(titleTokens);

  const coverage = distinct.filter((t) => present.has(t)).length / distinct.length;
  const titleCoverage = distinct.filter((t) => titlePresent.has(t)).length / distinct.length;

  let hits = 0;
  for (const term of distinct) hits += countIn(allTokens, term);
  const density = allTokens.length ? hits / (allTokens.length / 100) : 0;

  const q = (query || '').trim().toLowerCase();
  const haystack = `${cand.title}\n${cand.text}`.toLowerCase();
  const exactPhrase = q.length >= 3 && haystack.indexOf(q) !== -1 ? 1 : 0;

  return coverage * 2.5 + titleCoverage * 1.5 + exactPhrase * 1.0 + Math.min(density, 1) * 0.5;
};

/**
 * Run the full two-stage retrieval. `getNeighbors(id)` returns the ids of an item's
 * graph neighbours (wire it to graphModel.neighborsOf); only used when
 * `options.useGraphExpansion` is on.
 */
export const retrieveContext = (args: {
  query: string;
  queryVector?: number[];
  candidates: RetrievalCandidate[];
  getNeighbors?: (id: string) => string[];
  options?: RetrievalOptions;
}): RetrievedItem[] => {
  const { query, queryVector, candidates = [], getNeighbors, options = {} } = args;
  const useFulltext = options.useFulltext !== false;
  const useVector = options.useVector !== false;
  const useGraph = options.useGraphExpansion === true;
  const useRerank = options.useRerank !== false;
  const limit = Math.max(1, options.limit ?? 8);
  const pool = Math.max(limit, options.candidatePool ?? 50);
  const k = options.rrfK ?? 60;

  if (!query || !query.trim() || candidates.length === 0) return [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const queryTerms = tokenize(query);
  const via = new Map<string, Set<'fulltext' | 'vector' | 'graph'>>();
  const mark = (id: string, r: 'fulltext' | 'vector' | 'graph') => {
    const s = via.get(id) || new Set(); s.add(r); via.set(id, s);
  };

  // Stage 1 — sparse rung.
  const rankedLists: { id: string }[][] = [];
  if (useFulltext) {
    const ft = candidates
      .map((c) => ({ id: c.id, score: lexicalScore(queryTerms, c) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, pool);
    ft.forEach((x) => mark(x.id, 'fulltext'));
    rankedLists.push(ft);
  }
  // Stage 1 — dense rung.
  if (useVector && queryVector && queryVector.length) {
    const vec = candidates
      .filter((c) => c.vector && c.vector.length)
      .map((c) => ({ id: c.id, score: cosineSimilarity(queryVector, c.vector as number[]) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, pool);
    vec.forEach((x) => mark(x.id, 'vector'));
    rankedLists.push(vec);
  }

  // Fuse the recall rungs.
  let fused = reciprocalRankFusion(rankedLists, k);

  // Stage 1.5 — GraphRAG: expand the current top hits with their neighbours, ranked by
  // how many seeds point to them (centrality), and fuse that as a third list.
  if (useGraph && getNeighbors) {
    const seeds = Array.from(fused.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(10, pool))
      .map(([id]) => id);
    const seedSet = new Set(seeds);
    const neighborHits = new Map<string, number>();
    for (const seed of seeds) {
      let ns: string[] = [];
      try { ns = getNeighbors(seed) || []; } catch { ns = []; }
      for (const nid of ns) {
        if (!byId.has(nid) || seedSet.has(nid)) continue; // unknown/locked or already seeded
        neighborHits.set(nid, (neighborHits.get(nid) || 0) + 1);
      }
    }
    const graphList = Array.from(neighborHits.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, pool)
      .map(([id]) => ({ id }));
    graphList.forEach((x) => mark(x.id, 'graph'));
    if (graphList.length) fused = reciprocalRankFusion([Array.from(fused.keys()).map((id) => ({ id })), graphList], k);
  }

  // Build the stage-1 pool (top by fused score).
  const pooled = Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, pool)
    .map(([id, rrf]) => ({ cand: byId.get(id)!, rrf }))
    .filter((x) => !!x.cand);

  // Stage 2 — rerank (or keep the fused order).
  const scored = pooled.map(({ cand, rrf }) => ({
    cand,
    score: useRerank ? rerankScore(query, queryTerms, cand) : rrf,
  }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ cand, score }) => ({
    id: cand.id,
    kind: cand.kind,
    title: cand.title,
    text: cand.text,
    score,
    via: Array.from(via.get(cand.id) || []),
  }));
};

/** Render retrieved items into a compact, prompt-injectable context block. */
export const renderRetrievedContext = (items: RetrievedItem[], maxChars = 4000): string => {
  if (!items || items.length === 0) return '';
  const parts: string[] = [];
  let used = 0;
  for (const it of items) {
    const body = (it.text || '').slice(0, 600).trim();
    const block = `## ${it.title || '(utan titel)'} [${it.kind}]\n${body}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  if (parts.length === 0) return '';
  return `<relevant_kontext via="semantisk sökning">\n${parts.join('\n\n')}\n</relevant_kontext>\n\n`;
};
