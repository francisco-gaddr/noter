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
  type Note,
  type Task,
} from '@repo/shared';
import { resolveAiSettingsScope } from './settingsScope';

const CONFIG_KEY = 'embeddings_config';
const INDEX_KEY = 'embeddings_index';
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

// ---- index store -------------------------------------------------------------

export const getVectorIndex = async (model: string): Promise<VectorIndex> => {
  try {
    const raw = await AsyncStorage.getItem(await scoped(INDEX_KEY));
    if (!raw) return emptyVectorIndex(model);
    const parsed = JSON.parse(safeDecrypt(raw, raw) || 'null');
    if (parsed && Array.isArray(parsed.items) && typeof parsed.model === 'string') return parsed;
  } catch { /* fall through */ }
  return emptyVectorIndex(model);
};

const saveVectorIndex = async (index: VectorIndex): Promise<void> => {
  try { await AsyncStorage.setItem(await scoped(INDEX_KEY), encrypt(JSON.stringify(index))); } catch { /* best-effort */ }
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
  const diff = diffIndex(entities, index, config.model);

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

  const merged: VectorIndex = { model: config.model, items: [...diff.keep, ...fresh] };
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
    const [queryVector] = await embedTexts({ url, model: config.model, inputs: [query.trim()], apiKey, signal });
    if (!queryVector?.length) return [];
    return vectorSearch(queryVector, indexToEmbeddedItems(index), limit);
  } catch {
    return [];
  }
};

export const getIndexInfo = async (): Promise<{ total: number; model: string; enabled: boolean }> => {
  const config = await getEmbeddingsConfig();
  const index = await getVectorIndex(config.model);
  return { total: index.items.length, model: config.model, enabled: config.enabled };
};
