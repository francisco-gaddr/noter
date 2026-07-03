import type { ChatMessage } from "@repo/ai";
import {
  loadLlamaModel,
  completeLlama,
  unloadLlamaModel,
  isLlamaLinked,
  isLlamaLoaded,
  loadedModelPath,
  type LlamaCompletionOptions,
} from "./llama";
import { modelFileExists } from "./ModelDownloader";

/**
 * Owns the single resident on-device model. Real inference runs through llama.rn
 * (see ./llama) — a GGUF file is loaded directly, no conversion step. The old MLC
 * bridge is gone; this is the only local path now.
 */
class ModelManager {
  // Dedupe concurrent loads of the SAME model (e.g. a silent warm-preload racing the
  // on-send load) so we never call initLlama twice in parallel — that wedges the native
  // engine. Same-path callers share one in-flight promise; a different path waits its turn.
  private loadingPath: string | null = null;
  private loadingPromise: Promise<void> | null = null;

  /** Path of the GGUF currently loaded, or null. Backed by the llama context. */
  get currentModelPath(): string | null {
    return loadedModelPath();
  }

  /** True while a model load is in flight (used to show progress / avoid double work). */
  get isLoading(): boolean {
    return this.loadingPromise !== null;
  }

  get isModelLoaded(): boolean {
    return isLlamaLoaded();
  }

  /** True only when the native llama.rn engine is compiled into this build. */
  isAvailable(): boolean {
    return isLlamaLinked();
  }

  async load(path: string, onProgress?: (progress: number) => void) {
    if (this.isModelLoaded && this.currentModelPath === path) return;
    // Join an in-flight load of the SAME model instead of starting a second one.
    if (this.loadingPromise && this.loadingPath === path) return this.loadingPromise;
    if (!isLlamaLinked()) {
      throw new Error("Lokal AI-motor saknas i detta bygge. Installera EAS-bygget.");
    }
    if (!path) throw new Error("Ingen modell vald. Välj en nedladdad modell.");
    // A DIFFERENT model is mid-load: initLlama must never run twice in parallel
    // (it wedges the native engine). Wait the old load out — its outcome (including
    // errors) belongs to its own caller — then continue with ours.
    while (this.loadingPromise) {
      await this.loadingPromise.catch(() => { /* handled by the original caller */ });
    }
    // The awaited load may have loaded exactly what we want.
    if (this.isModelLoaded && this.currentModelPath === path) return;

    this.loadingPath = path;
    this.loadingPromise = (async () => {
      const exists = await modelFileExists(path);
      if (!exists) {
        throw new Error("Modellfilen hittades inte. Ladda ner modellen igen.");
      }
      // loadLlamaModel owns the load timeout + CPU/small-context fallback + a clear error
      // if even that fails, so an extra retry here would just double the (already slow)
      // attempts. Reset a possibly-wedged native context, then surface its message.
      try {
        await loadLlamaModel(path, {}, onProgress);
      } catch (e: any) {
        try { await unloadLlamaModel(); } catch { /* ignore */ }
        throw e instanceof Error ? e : new Error(String(e?.message || 'Kunde inte ladda modellen.'));
      }
    })();
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
      this.loadingPath = null;
    }
  }

  // Completions are serialized: llama.rn has ONE resident context, and two native
  // completions on it at once corrupt each other. Late callers queue behind the
  // current one instead of failing (each still has its own watchdog inside llama.ts).
  private completionChain: Promise<unknown> = Promise.resolve();

  /**
   * Run a chat completion on the resident model. Passing the `messages` array lets
   * llama.rn apply the model's own chat template. Streams tokens via opts.onToken.
   */
  async complete(messages: ChatMessage[], opts?: LlamaCompletionOptions) {
    if (!this.isModelLoaded) {
      throw new Error("Model not loaded");
    }
    const run = this.completionChain
      .catch(() => { /* the previous completion's error belongs to its caller */ })
      .then(() => {
        if (!this.isModelLoaded) throw new Error("Model not loaded");
        return completeLlama(messages, opts);
      });
    this.completionChain = run;
    return run;
  }

  async unload() {
    await unloadLlamaModel();
  }
}

export const modelManager = new ModelManager();

// A loaded model STAYS loaded for the app's lifetime — we no longer unload it when the
// app is backgrounded. Re-reading a multi-GB GGUF on every return was the source of the
// long "Laddar modell…" delay, and unloading mid-generation in the background is exactly
// what made local AI stop working when the user switched away. The model is released only
// on an explicit unload() (user deactivates / switches model — handled in load()). The OS
// may still reclaim the process under memory pressure; load() then transparently reloads.
