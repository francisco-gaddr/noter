/**
 * Embeddings HTTP client — the platform-agnostic core that turns text into vectors
 * via an OpenAI-compatible `/v1/embeddings` endpoint (Ollama, llama.cpp, LM Studio,
 * vLLM, OpenAI itself all speak this). Pure URL/shape helpers are unit-tested; the
 * one network function takes an injectable `fetchImpl` so it runs identically on web
 * + React Native and can be mocked in tests.
 *
 * The recommended/default path is a self-hosted model (Pi-Ollama / on-device) running
 * `nomic-embed-text` — no third-party sees the note content. This module never persists
 * anything; the encrypted vector store lives in each platform's service layer.
 */
import { fetchWithRetry } from './httpRetry';

/** A self-hosted embeddings endpoint (Ollama/llama.cpp) can be slow on CPU but must
 *  never hang the index build forever; bound each batch and retry one transient blip. */
const EMBEDDINGS_TIMEOUT_MS = 30_000;

/**
 * Normalise a base URL to the OpenAI-compatible embeddings endpoint. Accepts a full
 * `…/embeddings`, a `…/v1` root, or a bare host, and always lands on
 * `<base>/v1/embeddings`. Mirrors resolveChatCompletionsUrl so Hermes settings carry over.
 */
export const normalizeEmbeddingsUrl = (baseUrl: string): string => {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('Bas-URL saknas för inbäddningar');
  if (/\/embeddings$/.test(raw)) return raw;
  if (/\/v1$/.test(raw)) return `${raw}/embeddings`;
  return `${raw}/v1/embeddings`;
};

/** Build the OpenAI-compatible request body for a batch of input texts. */
export const buildEmbeddingsBody = (model: string, inputs: string[]): string =>
  JSON.stringify({ model, input: inputs });

/**
 * Parse an OpenAI-compatible embeddings response into a list of vectors, preserving
 * input order via each row's `index` when present. Returns [] on any shape mismatch.
 */
export const parseEmbeddingsResponse = (json: any, expected = 0): number[][] => {
  const data = json?.data;
  if (!Array.isArray(data)) return [];
  const rows = data
    .map((d: any, i: number) => ({
      index: Number.isFinite(d?.index) ? Number(d.index) : i,
      vector: Array.isArray(d?.embedding) ? d.embedding.map((n: any) => Number(n) || 0) : [],
    }))
    .sort((a, b) => a.index - b.index)
    .map((r) => r.vector);
  if (expected > 0 && rows.length !== expected) {
    // Endpoint returned a different count than asked — caller decides; return what we got.
    return rows;
  }
  return rows;
};

export interface EmbedTextsParams {
  url: string;
  model: string;
  inputs: string[];
  apiKey?: string;
  signal?: AbortSignal;
  /** Defaults to the global fetch; injected in tests / RN. */
  fetchImpl?: typeof fetch;
}

/**
 * Embed a batch of texts. Throws on a non-OK response (caller catches + surfaces).
 * Returns one vector per input, in input order.
 */
export const embedTexts = async (params: EmbedTextsParams): Promise<number[][]> => {
  const { url, model, inputs, apiKey, signal } = params;
  const doFetch = params.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) throw new Error('fetch är inte tillgängligt');
  if (!inputs.length) return [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchWithRetry(
    url,
    { method: 'POST', headers, body: buildEmbeddingsBody(model, inputs) },
    { signal, fetchImpl: doFetch, label: 'Inbäddningar', timeoutMs: EMBEDDINGS_TIMEOUT_MS, maxRetries: 1 },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Inbäddningsanrop misslyckades (${response.status})`);
  }
  const json = await response.json();
  return parseEmbeddingsResponse(json, inputs.length);
};
