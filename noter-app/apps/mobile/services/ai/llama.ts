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

// A model that never loads / never emits a token must NOT leave the chat spinning
// forever (the "står och tänker i all evighet" report). These caps turn a native
// stall into a clear, surfaced error instead of an infinite hang.
const LOAD_TIMEOUT_MS = 180_000;        // initLlama: large GGUFs are slow to mmap from storage.
const COMPLETION_INACTIVITY_MS = 75_000; // abort if no token arrives for this long.

/** Reject if `p` doesn't settle within `ms`. `onTimeout` runs best-effort cleanup. */
const withTimeout = <T>(p: Promise<T>, ms: number, message: string, onTimeout?: () => void): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { try { onTimeout?.(); } catch { /* ignore */ } reject(new Error(message)); }, ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
};

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
  const uri = toFileUri(modelPath);
  const attempt = (nCtx: number, nGpu: number, mlock: boolean) =>
    withTimeout(
      initLlama(
        {
          model: uri,
          n_ctx: nCtx,
          n_gpu_layers: nGpu,
          use_mlock: mlock,
        } as Parameters<typeof initLlama>[0],
        onProgress,
      ),
      LOAD_TIMEOUT_MS,
      'load-timeout',
    );
  try {
    context = await attempt(opts.nCtx ?? 4096, opts.nGpuLayers ?? 99, true);
  } catch (e) {
    // Large models (e.g. 8B) OOM the mobile GPU at 99 offloaded layers / 4k ctx and
    // then HANG in the native layer. Fall back to CPU-only (n_gpu_layers: 0), a
    // smaller 2k context and no mlock — slower but it actually loads instead of
    // spinning forever. If even this fails, surface a clear, actionable error.
    await unloadLlamaModel();
    try {
      context = await attempt(2048, 0, false);
    } catch (e2: any) {
      await unloadLlamaModel();
      const why = String(e2?.message || (e as any)?.message || '');
      const tooBig = why.includes('load-timeout') || /alloc|memory|oom/i.test(why);
      throw new Error(
        tooBig
          ? 'Modellen kunde inte laddas — den är troligen för stor för den här enheten. Prova en mindre modell (1–3B, t.ex. Q4).'
          : `Kunde inte ladda modellen (${why || 'okänt fel'}). Prova en mindre modell eller ladda ner den på nytt.`,
      );
    }
  }
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
  const ctx = context;
  const oaiMessages = (messages || []).map((m) => ({
    role: m.role === 'tool' ? 'assistant' : m.role,
    content: m.content || '',
  }));
  // Inactivity watchdog: if the native engine emits no token (and doesn't finish) for
  // COMPLETION_INACTIVITY_MS, stop it and reject — otherwise a stalled completion would
  // leave the chat "thinking" forever. The timer resets on every token, so a slow but
  // progressing generation is never killed.
  let lastActivity = Date.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const watchdogPromise = new Promise<never>((_, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > COMPLETION_INACTIVITY_MS) {
        if (watchdog) clearInterval(watchdog);
        ctx.stopCompletion?.().catch(() => {});
        reject(new Error('Den lokala modellen svarade inte i tid. Prova en mindre modell eller starta om appen.'));
      }
    }, 5000);
  });
  try {
    const result = await Promise.race([
      ctx.completion(
        {
          messages: oaiMessages as Parameters<LlamaContext['completion']>[0]['messages'],
          n_predict: opts.nPredict ?? 512,
          stop: opts.stop ?? [],
          temperature: opts.temperature ?? 0.7,
        } as Parameters<LlamaContext['completion']>[0],
        (data) => {
          lastActivity = Date.now();
          if (opts.shouldStop?.()) { ctx.stopCompletion?.().catch(() => {}); return; }
          if (data?.token) opts.onToken?.(data.token);
        },
      ),
      watchdogPromise,
    ]);
    return String((result as any)?.text ?? '');
  } finally {
    if (watchdog) clearInterval(watchdog);
  }
};

/** Release the resident context + free native memory. Safe to call when nothing is loaded. */
export const unloadLlamaModel = async (): Promise<void> => {
  try { await releaseAllLlama(); } catch { /* nothing loaded / native absent */ }
  context = null;
  loadedPath = null;
};
