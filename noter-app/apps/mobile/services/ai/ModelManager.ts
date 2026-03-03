import { AppState } from "react-native";

let RNFS: any;
try {
  RNFS = require("react-native-fs").default;
} catch {
  RNFS = {
    DocumentDirectoryPath: null,
    exists: async () => false,
    mkdir: async () => {},
    downloadFile: () => ({ promise: Promise.reject("Native module missing") }),
    unlink: async () => {},
  };
}

import { loadModel, chat, unloadModel } from "./native/MLCModule";
import { downloadCompiledModel } from "./ModelDownloader";

class ModelManager {
  currentModelPath: string | null = null;
  isModelLoaded: boolean = false;

  async install(modelMeta: { url: string; modelId: string; quantization?: string }) {
    const path = await downloadCompiledModel(modelMeta.url, modelMeta.modelId, modelMeta.quantization);
    this.currentModelPath = path;
    await loadModel(path);
    this.isModelLoaded = true;
  }

  async load(path: string) {
    if (this.isModelLoaded && this.currentModelPath === path) return;
    const exists = await RNFS.exists(path);
    if (!exists) throw new Error("Model path not found");
    const configExists = await RNFS.exists(`${path}/mlc-chat-config.json`);
    if (!configExists) throw new Error("Invalid model package");
    await loadModel(path);
    this.currentModelPath = path;
    this.isModelLoaded = true;
  }

  async chat(prompt: string) {
    if (!this.isModelLoaded) {
      throw new Error("Model not loaded");
    }
    return chat(prompt);
  }

  async unload() {
    await unloadModel();
    this.currentModelPath = null;
    this.isModelLoaded = false;
  }
}

export const modelManager = new ModelManager();

AppState.addEventListener('change', (state) => {
  if (state === 'background') {
    modelManager.unload().catch(() => {});
  }
});
