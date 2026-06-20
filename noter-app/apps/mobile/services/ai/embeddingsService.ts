/**
 * Mobile embeddings service — RN/Expo parity with apps/web/services/ai/embeddingsService.
 * Wraps the pure @repo/shared vector core with AsyncStorage (config + index, encrypted at
 * rest) and SecureStore (API key), scoped per user via resolveAiSettingsScope. Resolves
 * the OpenAI-compatible endpoint, (re)indexes the READABLE notes/tasks, and runs the
 * semantic rung of hybrid search.
 *
 * Security: only entities from @repo/shared/buildIndexableEntities are embedded — locked
 * notes / locked-project descendants never reach the index. Recommended source is a
 * self-hosted model (Pi-Ollama) so content stays on the user's own devices.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  encrypt,
  safeDecrypt,
  parseEmbeddingsConfig,
  serializeEmbeddingsConfig,
  defaultEmbeddingsConfig,
  DEFAULT_LOCAL_EMBEDDINGS_URL,
  embeddingText,
  embeddingContentHash,
  createLruCache,
  normalizeEmbeddingsUrl,
  embedTexts,
  diffIndex,
  buildVectorIndex,
  makeStoredVector,
  indexToEmbeddedItems,
  buildIndexableEntities,
  vectorSearch,
  emptyVectorIndex,
  isValidVectorIndex,
  buildGraph,
  neighborsOf,
  retrieveContext,
  renderRetrievedContext,
  meetsMinContextLevel,
  type EmbeddingsConfig,
  type VectorIndex,
  type StoredVector,
  type VectorHit,
  type RetrievalCandidate,
  type Note,
  type Task,
} from '@repo/shared';
import { resolveAiSettingsScope } from './settingsScope';

const CONFIG_KEY = 'embeddings_config';
const INDEX_KEY = 'embeddings_index';
const INDEX_CORRUPT_KEY = 'embeddings_index__corrupt';
let loggedIndexCorruption = false;
const APIKEY_KEY = 'embeddings_api_key';
const EMBED_BATCH = 32;

const scoped = async (key: string) => `${key}_${await resolveAiSettingsScope()}`;

// ---- settings ----------------------------------------------------------------

export const getEmbeddingsConfig = async (): Promise<EmbeddingsConfig> => {
  try {
    const raw = await AsyncStorage.getItem(await scoped(CONFIG_KEY));
    if (!raw) return defaultEmbeddingsConfig();
    return parseEmbeddingsConfig(safeDecrypt(raw, raw));
  } catch {
    return defaultEmbeddingsConfig();
  }
};

export const saveEmbeddingsConfig = async (config: EmbeddingsConfig): Promise<void> => {
  try { await AsyncStorage.setItem(await scoped(CONFIG_KEY), encrypt(serializeEmbeddingsConfig(config))); } catch { /* best-effort */ }
};

export const getEmbeddingsApiKey = async (): Promise<string> => {
  try { return (await SecureStore.getItemAsync(await scoped(APIKEY_KEY))) || ''; } catch { return ''; }
};

export const saveEmbeddingsApiKey = async (key: string): Promise<void> => {
  try {
    const k = await scoped(APIKEY_KEY);
    if (!key) { await SecureStore.deleteItemAsync(k).catch(() => {}); return; }
    await SecureStore.setItemAsync(k, key);
  } catch { /* best-effort */ }
};

// ---- endpoint resolution -----------------------------------------------------

const effectiveBaseUrl = (config: EmbeddingsConfig): string => {
  if (config.source === 'local') return (config.baseUrl || '').trim() || DEFAULT_LOCAL_EMBEDDINGS_URL;
  return (config.baseUrl || '').trim();
};

const resolveEndpoint = async (config: EmbeddingsConfig): Promise<{ url: string; apiKey: string }> => ({
  url: normalizeEmbeddingsUrl(effectiveBaseUrl(config)),
  apiKey: await getEmbeddingsApiKey(),
});

// Query-embedding cache (see web service): a query's embedding is deterministic for a given
// provider+model, so memoise it — chat re-embeds every turn and semanticSearch every call. Keyed by
// provider|model|hash. Bounded LRU.
const queryVectorCache = createLruCache<number[]>(64);
const embedQuery = async (
  config: EmbeddingsConfig,
  url: string,
  apiKey: string,
  query: string,
  signal?: AbortSignal,
): Promise<number[]> => {
  const q = query.trim();
  if (!q) return [];
  const key = `${config.source}|${config.model}|${embeddingContentHash(q)}`;
  const cached = queryVectorCache.get(key);
  if (cached) return cached;
  const [vec] = await embedTexts({ url, model: config.model, inputs: [q], apiKey, signal });
  if (vec?.length) queryVectorCache.set(key, vec);
  return vec || [];
};

// ---- index store -------------------------------------------------------------

export const getVectorIndex = async (model: string): Promise<VectorIndex> => {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(await scoped(INDEX_KEY));
  } catch { return emptyVectorIndex(model); }
  if (!raw) return emptyVectorIndex(model); // genuinely absent — fine
  try {
    const dec = safeDecrypt(raw, '');
    const parsed = dec ? JSON.parse(dec) : null;
    if (isValidVectorIndex(parsed)) return parsed;
    throw new Error('decrypted index is not a valid VectorIndex');
  } catch (e) {
    // Present but unreadable → CORRUPTION, not absence. Observable + quarantine so the next save can't
    // silently overwrite it (the index is a derived cache — we re-embed loudly). Self-heals on rebuild.
    if (!loggedIndexCorruption) {
      console.error('[embeddings] vector index unreadable (corrupt/undecryptable) — quarantining + rebuilding', e);
      loggedIndexCorruption = true;
    }
    try {
      const ck = await scoped(INDEX_CORRUPT_KEY);
      if (!(await AsyncStorage.getItem(ck))) await AsyncStorage.setItem(ck, raw);
    } catch { /* ignore */ }
    return emptyVectorIndex(model);
  }
};

const saveVectorIndex = async (index: VectorIndex): Promise<void> => {
  if (!isValidVectorIndex(index)) {
    console.error('[embeddings] refusing to persist an invalid vector index');
    return;
  }
  try { await AsyncStorage.setItem(await scoped(INDEX_KEY), encrypt(JSON.stringify(index))); }
  catch (e) { console.error('[embeddings] failed to persist vector index (keeping previous value)', e); }
};

export const clearVectorIndex = async (): Promise<void> => {
  try { await AsyncStorage.removeItem(await scoped(INDEX_KEY)); } catch { /* ignore */ }
};

export interface IndexResult {
  indexed: number;
  kept: number;
  removed: number;
  total: number;
  ok: boolean;
  error?: string;
}

export const indexEntities = async (
  notes: Note[],
  tasks: Task[],
  unlockedIds: Set<string>,
  onProgress?: (done: number, toDo: number) => void,
  signal?: AbortSignal,
): Promise<IndexResult> => {
  const config = await getEmbeddingsConfig();
  if (!config.enabled) return { indexed: 0, kept: 0, removed: 0, total: 0, ok: false, error: 'Semantisk sök är avstängd' };

  const entities = buildIndexableEntities(notes, tasks, unlockedIds);
  const index = await getVectorIndex(config.model);
  const diff = diffIndex(entities, index, config.model, config.source);

  let endpoint: { url: string; apiKey: string };
  try {
    endpoint = await resolveEndpoint(config);
  } catch (e: any) {
    return { indexed: 0, kept: diff.keep.length, removed: diff.removed, total: diff.keep.length, ok: false, error: e?.message || 'Ogiltig URL' };
  }

  const fresh: StoredVector[] = [];
  let done = 0;
  try {
    for (let i = 0; i < diff.toEmbed.length; i += EMBED_BATCH) {
      if (signal?.aborted) break;
      const batch = diff.toEmbed.slice(i, i + EMBED_BATCH);
      const inputs = batch.map((e) => embeddingText(e.title, e.body));
      const vectors = await embedTexts({ url: endpoint.url, model: config.model, inputs, apiKey: endpoint.apiKey, signal });
      batch.forEach((e, j) => {
        const vec = vectors[j];
        if (vec && vec.length) fresh.push(makeStoredVector(e, vec, config.model));
      });
      done += batch.length;
      onProgress?.(done, diff.toEmbed.length);
    }
  } catch (e: any) {
    return { indexed: fresh.length, kept: diff.keep.length, removed: diff.removed, total: diff.keep.length + fresh.length, ok: false, error: e?.message || 'Inbäddning misslyckades' };
  }

  const merged = buildVectorIndex(config.model, config.source, [...diff.keep, ...fresh]);
  await saveVectorIndex(merged);
  return { indexed: fresh.length, kept: diff.keep.length, removed: diff.removed, total: merged.items.length, ok: true };
};

export const semanticSearch = async (query: string, limit = 20, signal?: AbortSignal): Promise<VectorHit[]> => {
  const config = await getEmbeddingsConfig();
  if (!config.enabled || !query.trim()) return [];
  const index = await getVectorIndex(config.model);
  if (!index.items.length) return [];
  try {
    const { url, apiKey } = await resolveEndpoint(config);
    const queryVector = await embedQuery(config, url, apiKey, query, signal);
    if (!queryVector.length) return [];
    return vectorSearch(queryVector, indexToEmbeddedItems(index), limit);
  } catch {
    return [];
  }
};

export interface ChatRetrievalOptions {
  /** Master switch — run semantic retrieval at all. */
  enableSemantic?: boolean;
  /** GraphRAG: expand the top hits with their graph neighbours. */
  enableGraphRAG?: boolean;
  /** Stage-2 query-aware rerank. */
  enableRerank?: boolean;
  /** Max items injected into the chat context. */
  limit?: number;
  /** Current chat context level — gates per-source minContextLevel eligibility. */
  contextLevel?: string;
  /** Map of ingest connectionId → its minContextLevel (notes below the current level are dropped). */
  sourceMinLevels?: Record<string, string>;
}

/**
 * Retrieve relevant, LOCK-SAFE context for an AI-chat turn and render it as a prompt block
 * (the full two-stage RAG: lexical + vector recall → optional GraphRAG → rerank). Returns ''
 * when nothing relevant (or retrieval is off). The candidate set is the readable notes/tasks
 * only (locked content is filtered by buildIndexableEntities), so neither the lexical rung,
 * the vector rung, nor a graph neighbour can ever surface a locked note.
 */
export const retrieveForChat = async (
  query: string,
  notes: Note[],
  tasks: Task[],
  unlockedIds: Set<string>,
  opts: ChatRetrievalOptions = {},
  signal?: AbortSignal,
): Promise<string> => {
  if (!query.trim() || opts.enableSemantic === false) return '';
  try {
    let entities = buildIndexableEntities(notes, tasks, unlockedIds); // lock-aware
    if (entities.length === 0) return '';

    // Per-source context-level gate: drop notes from synced connections whose minContextLevel
    // the current chat level doesn't meet (e.g. a heavy archive only on 'deep').
    const sourceMinLevels = opts.sourceMinLevels;
    if (sourceMinLevels && Object.keys(sourceMinLevels).length > 0) {
      const ineligible = new Set<string>();
      for (const n of notes as any[]) {
        const src = (n as any).source;
        if (src && src.connectionId && !meetsMinContextLevel(opts.contextLevel, sourceMinLevels[src.connectionId])) {
          ineligible.add(n._id);
        }
      }
      if (ineligible.size > 0) entities = entities.filter((e) => !ineligible.has(e.id));
    }

    // Dense rung: pull the query vector + per-id vectors from the encrypted index (if on).
    const config = await getEmbeddingsConfig();
    const vecById = new Map<string, number[]>();
    let queryVector: number[] | undefined;
    if (config.enabled) {
      const index = await getVectorIndex(config.model);
      for (const it of index.items) vecById.set(it.id, it.vector);
      try {
        const { url, apiKey } = await resolveEndpoint(config);
        const qv = await embedQuery(config, url, apiKey, query, signal);
        if (qv.length) queryVector = qv;
      } catch { /* lexical-only fallback */ }
    }

    const candidates: RetrievalCandidate[] = entities.map((e) => ({
      id: e.id, kind: e.kind, title: e.title, text: e.body, vector: vecById.get(e.id),
    }));

    let getNeighbors: ((id: string) => string[]) | undefined;
    if (opts.enableGraphRAG) {
      const graph = buildGraph(notes, tasks);
      // SECURITY: the graph is built from ALL notes, so a neighbour could be a LOCKED note.
      // Constrain expansion to the lock-filtered candidate set so a graph hop can NEVER
      // surface a locked note's title/relations.
      const candidateIds = new Set(candidates.map((c) => c.id));
      getNeighbors = (id: string) => {
        const n = neighborsOf(graph, id);
        if (!n) return [];
        return [...n.outgoing.map((o) => o.node.id), ...n.incoming.map((o) => o.node.id)]
          .filter((nid) => candidateIds.has(nid));
      };
    }

    const items = retrieveContext({
      query, queryVector, candidates, getNeighbors,
      options: { useGraphExpansion: !!opts.enableGraphRAG, useRerank: opts.enableRerank !== false, limit: opts.limit ?? 6 },
    });
    return renderRetrievedContext(items);
  } catch {
    return '';
  }
};

export const getIndexInfo = async (): Promise<{ total: number; model: string; enabled: boolean }> => {
  const config = await getEmbeddingsConfig();
  const index = await getVectorIndex(config.model);
  return { total: index.items.length, model: config.model, enabled: config.enabled };
};
