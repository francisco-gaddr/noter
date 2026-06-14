/**
 * Web/Electron embeddings service — the IO layer around the pure @repo/shared vector
 * core. It persists the user's embeddings settings, the API key, and the encrypted
 * vector index in localStorage (encrypted at rest, parity with usageTracker), resolves
 * the OpenAI-compatible endpoint, (re)indexes the readable notes/tasks, and runs the
 * semantic rung of hybrid search.
 *
 * Security: indexing only ever sees the entities @repo/shared/buildIndexableEntities
 * returns — locked notes / locked-project descendants are filtered out before any text
 * leaves the device. The recommended source is a self-hosted model (Pi-Ollama / local
 * Ollama) so note content never reaches a third party.
 */
import {
  encrypt,
  safeDecrypt,
  parseEmbeddingsConfig,
  serializeEmbeddingsConfig,
  defaultEmbeddingsConfig,
  DEFAULT_LOCAL_EMBEDDINGS_URL,
  embeddingText,
  normalizeEmbeddingsUrl,
  embedTexts,
  diffIndex,
  makeStoredVector,
  indexToEmbeddedItems,
  buildIndexableEntities,
  vectorSearch,
  emptyVectorIndex,
  type EmbeddingsConfig,
  type VectorIndex,
  type StoredVector,
  type VectorHit,
  type IndexableEntity,
} from '@repo/shared';
import type { Note, Task } from '@repo/shared';

const CONFIG_KEY = 'embeddings_config_v1';
const APIKEY_KEY = 'embeddings_api_key_v1';
const INDEX_KEY = 'embeddings_index_v1';
const EMBED_BATCH = 32;

const readEncryptedJson = <T>(key: string, fallback: T): T => {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(safeDecrypt(raw, raw) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};
const writeEncryptedJson = (key: string, value: unknown): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, encrypt(JSON.stringify(value)));
  } catch {
    /* best-effort */
  }
};

// ---- settings ----------------------------------------------------------------

export const getEmbeddingsConfig = (): EmbeddingsConfig => {
  if (typeof localStorage === 'undefined') return defaultEmbeddingsConfig();
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return defaultEmbeddingsConfig();
  return parseEmbeddingsConfig(safeDecrypt(raw, raw));
};

export const saveEmbeddingsConfig = (config: EmbeddingsConfig): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CONFIG_KEY, encrypt(serializeEmbeddingsConfig(config)));
  } catch {
    /* best-effort */
  }
};

export const getEmbeddingsApiKey = (): string => {
  if (typeof localStorage === 'undefined') return '';
  const raw = localStorage.getItem(APIKEY_KEY);
  if (!raw) return '';
  try { return safeDecrypt(raw, raw) || ''; } catch { return ''; }
};

export const saveEmbeddingsApiKey = (key: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!key) { localStorage.removeItem(APIKEY_KEY); return; }
    localStorage.setItem(APIKEY_KEY, encrypt(key));
  } catch {
    /* best-effort */
  }
};

// ---- endpoint resolution -----------------------------------------------------

/** Resolve the effective base URL for the configured source. */
const effectiveBaseUrl = (config: EmbeddingsConfig): string => {
  if (config.source === 'local') return (config.baseUrl || '').trim() || DEFAULT_LOCAL_EMBEDDINGS_URL;
  return (config.baseUrl || '').trim();
};

export const resolveEmbeddingsEndpoint = (config: EmbeddingsConfig): { url: string; apiKey: string } => ({
  url: normalizeEmbeddingsUrl(effectiveBaseUrl(config)),
  apiKey: getEmbeddingsApiKey(),
});

// ---- index store -------------------------------------------------------------

export const getVectorIndex = (model: string): VectorIndex => {
  const stored = readEncryptedJson<VectorIndex | null>(INDEX_KEY, null);
  if (stored && Array.isArray(stored.items) && typeof stored.model === 'string') return stored;
  return emptyVectorIndex(model);
};

const saveVectorIndex = (index: VectorIndex): void => writeEncryptedJson(INDEX_KEY, index);

export const clearVectorIndex = (): void => {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(INDEX_KEY); } catch { /* ignore */ }
};

export interface IndexResult {
  indexed: number;
  kept: number;
  removed: number;
  total: number;
  ok: boolean;
  error?: string;
}

/**
 * (Re)index the readable notes + tasks: embed only entities whose content (or the
 * model) changed, drop vanished ones, and persist the merged index encrypted.
 * `onProgress(done, toDo)` is called per batch so the UI can show progress.
 */
export const indexEntities = async (
  notes: Note[],
  tasks: Task[],
  unlockedIds: Set<string>,
  onProgress?: (done: number, toDo: number) => void,
  signal?: AbortSignal,
): Promise<IndexResult> => {
  const config = getEmbeddingsConfig();
  if (!config.enabled) return { indexed: 0, kept: 0, removed: 0, total: 0, ok: false, error: 'Semantisk sök är avstängd' };

  const entities = buildIndexableEntities(notes, tasks, unlockedIds);
  const index = getVectorIndex(config.model);
  const diff = diffIndex(entities, index, config.model);

  let endpoint: { url: string; apiKey: string };
  try {
    endpoint = resolveEmbeddingsEndpoint(config);
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

  const merged: VectorIndex = { model: config.model, items: [...diff.keep, ...fresh] };
  saveVectorIndex(merged);
  return { indexed: fresh.length, kept: diff.keep.length, removed: diff.removed, total: merged.items.length, ok: true };
};

/**
 * Semantic rung of hybrid search: embed the query and rank the stored index by cosine.
 * Returns [] (and never throws) when disabled, unconfigured, or the endpoint fails — the
 * caller fuses whatever it gets with the always-available fulltext rung.
 */
export const semanticSearch = async (query: string, limit = 20, signal?: AbortSignal): Promise<VectorHit[]> => {
  const config = getEmbeddingsConfig();
  if (!config.enabled || !query.trim()) return [];
  const index = getVectorIndex(config.model);
  if (!index.items.length) return [];
  try {
    const { url, apiKey } = resolveEmbeddingsEndpoint(config);
    const [queryVector] = await embedTexts({ url, model: config.model, inputs: [query.trim()], apiKey, signal });
    if (!queryVector?.length) return [];
    return vectorSearch(queryVector, indexToEmbeddedItems(index), limit);
  } catch {
    return [];
  }
};

export const getIndexInfo = (): { total: number; model: string; enabled: boolean } => {
  const config = getEmbeddingsConfig();
  const index = getVectorIndex(config.model);
  return { total: index.items.length, model: config.model, enabled: config.enabled };
};

export type { EmbeddingsConfig, IndexableEntity };
