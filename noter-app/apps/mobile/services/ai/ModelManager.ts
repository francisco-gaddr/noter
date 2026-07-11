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
import { modelFileExists, verifyModelFile } from "./ModelDownloader";

/**
 * Owns the single resident on-device model. Real inference runs through llama.rn
 * (see ./llama) — a GGUF file is loaded directly, no conversion step. The old MLC
 * bridge is gone; this is the only local path now.
 */
class ModelManager {
  // ONE serial queue for EVERY native operation (load, unload, complete). llama.rn has a single
  // resident context; a release (unloadLlamaModel → releaseAllLlama) that overlaps an in-flight
  // completion frees the context mid-stream → native SIGSEGV (the "crashes while chatting with a
  // local model" report). Serializing all three through this mutex makes overlap impossible: a
  // model switch waits for the current generation to finish instead of crashing it.
  private opChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    // Chain after whatever is running; a prior op's error belongs to ITS caller, not the next op.
    const run = this.opChain.catch(() => { /* previous op's error is the previous caller's */ }).then(op);
    // Keep the chain alive regardless of this op's outcome.
    this.opChain = run.catch(() => { /* swallow for the chain; the real result is returned to caller */ });
    return run;
  }

  // Dedupe concurrent loads of the SAME model (e.g. a silent warm-preload racing the on-send load)
  // so callers share one in-flight promise instead of queueing a redundant second load.
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
    // Join an in-flight load of the SAME model instead of queueing a redundant second one.
    if (this.loadingPromise && this.loadingPath === path) return this.loadingPromise;
    if (!isLlamaLinked()) {
      throw new Error("Lokal AI-motor saknas i detta bygge. Installera EAS-bygget.");
    }
    if (!path) throw new Error("Ingen modell vald. Välj en nedladdad modell.");

    this.loadingPath = path;
    // The load runs through the shared mutex, so it waits for any in-flight COMPLETION to finish
    // before it can (via loadLlamaModel) release/replace the native context — never mid-stream.
    this.loadingPromise = this.enqueue(async () => {
      if (this.isModelLoaded && this.currentModelPath === path) return; // a queued op already loaded it
      const exists = await modelFileExists(path);
      if (!exists) {
        throw new Error("Modellfilen hittades inte. Ladda ner modellen igen.");
      }
      // INTEGRITY GATE: never hand a truncated/corrupt/HTML-as-.gguf file to native initLlama — that
      // aborts the whole process (SIGABRT) instead of throwing. Fail here with a clear re-download story.
      const intact = await verifyModelFile(path);
      if (!intact) {
        throw new Error("Modellfilen är skadad eller ofullständig. Ta bort och ladda ner modellen igen.");
      }
      // loadLlamaModel owns the load timeout + CPU/small-context fallback + a clear error if even that
      // fails. Reset a possibly-wedged native context on failure, then surface its message.
      try {
        await loadLlamaModel(path, {}, onProgress);
      } catch (e: any) {
        try { await unloadLlamaModel(); } catch { /* ignore */ }
        throw e instanceof Error ? e : new Error(String(e?.message || 'Kunde inte ladda modellen.'));
      }
    });
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
      this.loadingPath = null;
    }
  }

  /**
   * Run a chat completion on the resident model. Passing the `messages` array lets llama.rn apply the
   * model's own chat template. Streams tokens via opts.onToken. Serialized against load/unload through
   * the shared mutex so the context can never be freed underneath it.
   */
  async complete(messages: ChatMessage[], opts?: LlamaCompletionOptions) {
    if (!this.isModelLoaded) {
      throw new Error("Model not loaded");
    }
    return this.enqueue(() => {
      if (!this.isModelLoaded) throw new Error("Model not loaded");
      return completeLlama(messages, opts);
    });
  }

  /** Release the resident model — serialized so it can never overlap an in-flight completion. */
  async unload() {
    await this.enqueue(() => unloadLlamaModel());
  }
}

export const modelManager = new ModelManager();

// A loaded model STAYS loaded for the app's lifetime — we no longer unload it when the
// app is backgrounded. Re-reading a multi-GB GGUF on every return was the source of the
// long "Laddar modell…" delay, and unloading mid-generation in the background is exactly
// what made local AI stop working when the user switched away. The model is released only
// on an explicit unload() (user deactivates / switches model — handled in load()). The OS
// may still reclaim the process under memory pressure; load() then transparently reloads.
