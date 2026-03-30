import { AppState } from "react-native";

import { loadModel, chat, unloadModel } from "./native/MLCModule";
import { downloadCompiledModel, validateModelPackage } from "./ModelDownloader";
import { isAiBackgroundWorkEnabled } from "./runtimeSettings";
import { getReactNativeFs } from "./nativeRuntime";

class ModelManager {
  currentModelPath: string | null = null;
  isModelLoaded: boolean = false;

  private async replaceLoadedModel(nextPath: string) {
    if (this.isModelLoaded && this.currentModelPath === nextPath) {
      return false;
    }
    if (this.isModelLoaded && this.currentModelPath && this.currentModelPath !== nextPath) {
      await unloadModel();
      this.isModelLoaded = false;
      this.currentModelPath = null;
    }
    return true;
  }

  private async assertModelPathReady(path: string) {
    const RNFS = getReactNativeFs() || {
      exists: async () => false,
    };
    const exists = await RNFS.exists(path);
    if (!exists) throw new Error("Model path not found");
    const configExists = await RNFS.exists(`${path}/mlc-chat-config.json`);
    if (!configExists) throw new Error("Invalid model package");
  }

  async install(modelMeta: { url: string; modelId: string; quantization?: string }) {
    const downloadedPath = await downloadCompiledModel(modelMeta.url, modelMeta.modelId, modelMeta.quantization);
    const resolvedPath = await validateModelPackage(downloadedPath);
    const shouldLoad = await this.replaceLoadedModel(resolvedPath);
    if (!shouldLoad) return;
    await this.assertModelPathReady(resolvedPath);
    await loadModel(resolvedPath);
    this.currentModelPath = resolvedPath;
    this.isModelLoaded = true;
  }

  async load(path: string) {
    const resolvedPath = await validateModelPackage(path);
    const shouldLoad = await this.replaceLoadedModel(resolvedPath);
    if (!shouldLoad) return;
    await this.assertModelPathReady(resolvedPath);
    await loadModel(resolvedPath);
    this.currentModelPath = resolvedPath;
    this.isModelLoaded = true;
  }

  async chat(prompt: string) {
    if (!this.isModelLoaded) {
      throw new Error("Model not loaded");
    }
    return chat(prompt);
  }

  async unload() {
    if (!this.isModelLoaded && !this.currentModelPath) {
      return;
    }
    await unloadModel();
    this.currentModelPath = null;
    this.isModelLoaded = false;
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
