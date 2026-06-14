/**
 * On-device LLM inference via llama.rn (llama.cpp for React Native).
 *
 * This is the REAL local-model path (replaces the stubbed MLC bridge): it runs a GGUF
 * model directly on the phone — no GGUF→MLC conversion step, no server round-trip. The
 * model's own chat template is applied automatically by passing the OpenAI-style
 * `messages` array to `completion()`.
 *
 * Best-practice defaults for a phone: a single resident context (one model at a time),
 * GPU/Metal offload when available (n_gpu_layers, llama.cpp falls back to CPU), mlock to
 * keep weights resident, and a modest context window. The native module is only present
 * in a real dev/EAS build — under jest it's mocked, and `isLlamaLinked()` lets callers
 * degrade gracefully when it isn't compiled in.
 */
import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';
import type { ChatMessage } from '@repo/ai';

let context: LlamaContext | null = null;
let loadedPath: string | null = null;

const toFileUri = (p: string): string => (p.startsWith('file://') ? p : `file://${p}`);

/** True when the native llama.rn engine is compiled into this build. */
export const isLlamaLinked = (): boolean => typeof initLlama === 'function';

/** True when a model context is currently resident. */
export const isLlamaLoaded = (): boolean => context !== null;

export const loadedModelPath = (): string | null => loadedPath;

export interface LlamaLoadOptions {
  /** Context window (tokens). 4096 is a sane phone default. */
  nCtx?: number;
  /** Layers offloaded to GPU/Metal; llama.cpp falls back to CPU for the rest. */
  nGpuLayers?: number;
}

/**
 * Load a GGUF model into a single resident context. No-op if the same path is already
 * loaded; swaps the context otherwise (only one model resident at a time on a phone).
 */
export const loadLlamaModel = async (
  modelPath: string,
  opts: LlamaLoadOptions = {},
  onProgress?: (progress: number) => void,
): Promise<void> => {
  if (context && loadedPath === modelPath) return;
  await unloadLlamaModel();
  context = await initLlama(
    {
      model: toFileUri(modelPath),
      n_ctx: opts.nCtx ?? 4096,
      n_gpu_layers: opts.nGpuLayers ?? 99,
      use_mlock: true,
    } as Parameters<typeof initLlama>[0],
    onProgress,
  );
  loadedPath = modelPath;
};

export interface LlamaCompletionOptions {
  onToken?: (token: string) => void;
  stop?: string[];
  nPredict?: number;
  temperature?: number;
  /** Polled during streaming; when it returns true the native completion is stopped. */
  shouldStop?: () => boolean;
}

/**
 * Run a chat completion on the resident model, streaming tokens via `onToken`. Passing
 * the `messages` array lets llama.rn apply the model's built-in chat template. Returns
 * the full assistant text.
 */
export const completeLlama = async (messages: ChatMessage[], opts: LlamaCompletionOptions = {}): Promise<string> => {
  if (!context) throw new Error('Ingen lokal modell är laddad');
  const oaiMessages = (messages || []).map((m) => ({
    role: m.role === 'tool' ? 'assistant' : m.role,
    content: m.content || '',
  }));
  const result = await context.completion(
    {
      messages: oaiMessages as Parameters<LlamaContext['completion']>[0]['messages'],
      n_predict: opts.nPredict ?? 512,
      stop: opts.stop ?? [],
      temperature: opts.temperature ?? 0.7,
    } as Parameters<LlamaContext['completion']>[0],
    (data) => {
      if (opts.shouldStop?.()) { context?.stopCompletion?.().catch(() => {}); return; }
      if (data?.token) opts.onToken?.(data.token);
    },
  );
  return String(result?.text ?? '');
};

/** Release the resident context + free native memory. Safe to call when nothing is loaded. */
export const unloadLlamaModel = async (): Promise<void> => {
  try { await releaseAllLlama(); } catch { /* nothing loaded / native absent */ }
  context = null;
  loadedPath = null;
};
