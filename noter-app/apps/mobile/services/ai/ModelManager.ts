import { AppState } from "react-native";

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
import { isAiBackgroundWorkEnabled } from "./runtimeSettings";

let RNFS: any;
try {
  RNFS = require("react-native-fs").default;
} catch {
  RNFS = { exists: async () => true };
}

/**
 * Owns the single resident on-device model. Real inference runs through llama.rn
 * (see ./llama) — a GGUF file is loaded directly, no conversion step. The old MLC
 * bridge is gone; this is the only local path now.
 */
class ModelManager {
  /** Path of the GGUF currently loaded, or null. Backed by the llama context. */
  get currentModelPath(): string | null {
    return loadedModelPath();
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
    const exists = await RNFS.exists(path).catch(() => true);
    if (!exists) throw new Error("Model path not found");
    await loadLlamaModel(path, {}, onProgress);
  }

  /**
   * Run a chat completion on the resident model. Passing the `messages` array lets
   * llama.rn apply the model's own chat template. Streams tokens via opts.onToken.
   */
  async complete(messages: ChatMessage[], opts?: LlamaCompletionOptions) {
    if (!this.isModelLoaded) {
      throw new Error("Model not loaded");
    }
    return completeLlama(messages, opts);
  }

  async unload() {
    await unloadLlamaModel();
  }
}

export const modelManager = new ModelManager();

AppState.addEventListener('change', (state) => {
  if (state === 'background') {
    isAiBackgroundWorkEnabled()
      .then((enabled) => {
        if (!enabled) {
          modelManager.unload().catch(() => {});
        }
      })
      .catch(() => {
        modelManager.unload().catch(() => {});
      });
  }
});
