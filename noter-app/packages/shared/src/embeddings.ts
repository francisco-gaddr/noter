/**
 * Embeddings configuration — the user-regulated settings for semantic (vector) search:
 * whether it's on, which device runs the embedding model, which model, and the endpoint.
 * Mirrors the agent `source` model (local / hermes / api) so the same provider plumbing
 * is reused. Stored encrypted locally like the rest of the AI settings.
 *
 * Default model is `nomic-embed-text` — the recommended lightweight local embedding model
 * (768-dim, 8k context, runs on CPU), available on Ollama/Hermes; the user can change it.
 */
export type EmbeddingSource = 'local' | 'hermes' | 'api';

export interface EmbeddingsConfig {
  /** Master switch — semantic search + indexing only run when true. */
  enabled: boolean;
  /** Where the embedding model runs. */
  source: EmbeddingSource;
  /** Provider id (for api/hermes) or local engine id. */
  provider?: string;
  /** Embedding model id. */
  model: string;
  /** Base URL for hermes/local OpenAI-compatible or Ollama endpoint. */
  baseUrl?: string;
  /** Re-embed automatically when content changes (vs. manual "Indexera nu"). */
  autoIndex: boolean;
}

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

/** Default base URL for the `local` source — a local Ollama daemon (OpenAI-compatible). */
export const DEFAULT_LOCAL_EMBEDDINGS_URL = 'http://localhost:11434';

export const defaultEmbeddingsConfig = (): EmbeddingsConfig => ({
  enabled: false,
  source: 'hermes',
  model: DEFAULT_EMBEDDING_MODEL,
  autoIndex: false,
});

/** Tolerantly parse a stored config (object or JSON string); fills defaults. */
export const parseEmbeddingsConfig = (raw: unknown): EmbeddingsConfig => {
  const d = defaultEmbeddingsConfig();
  let obj: any = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return d; } }
  if (!obj || typeof obj !== 'object') return d;
  return {
    enabled: !!obj.enabled,
    source: obj.source === 'local' || obj.source === 'api' || obj.source === 'hermes' ? obj.source : d.source,
    provider: typeof obj.provider === 'string' ? obj.provider : undefined,
    model: typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : d.model,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    autoIndex: !!obj.autoIndex,
  };
};

export const serializeEmbeddingsConfig = (c: EmbeddingsConfig): string => JSON.stringify(c);

/**
 * The text to embed for a note/task — title weighted by repetition + a content slice.
 * Kept small + deterministic so re-embedding only happens on real content change.
 */
export const embeddingText = (title: string, body: string, maxChars = 1500): string => {
  const t = (title || '').trim();
  const b = (body || '').trim();
  return `${t}\n${t}\n${b}`.slice(0, maxChars).trim();
};

/** A short stable hash of the embedding text, to detect when a re-embed is needed. */
export const embeddingContentHash = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${text.length}`;
};
