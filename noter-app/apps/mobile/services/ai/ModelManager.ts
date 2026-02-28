import RNFS from "react-native-fs";
import { loadModel, chat } from "./native/MLCModule";

// Safe path getter that handles potential nulls in dev/web environments
const getModelsDir = () => {
    if (!RNFS || !RNFS.DocumentDirectoryPath) {
        // Fallback or throw if critical
        console.warn("RNFS not available (likely running in Expo Go or Web). Native modules required.");
        return null;
    }
    return `${RNFS.DocumentDirectoryPath}/models`;
};

export async function downloadModel(downloadUrl: string, fileName: string) {
  const modelsDir = getModelsDir();
  if (!modelsDir) throw new Error("Native filesystem not available");
  
  const destPath = `${modelsDir}/${fileName}`;

  const exists = await RNFS.exists(modelsDir);
  if (!exists) {
      await RNFS.mkdir(modelsDir);
  }

  const download = RNFS.downloadFile({
    fromUrl: downloadUrl,
    toFile: destPath,
    background: true,
    discretionary: true,
  });

  const result = await download.promise;

  if (result.statusCode !== 200) {
    throw new Error("Download failed");
  }

  return destPath;
}

class ModelManager {
  currentModelPath: string | null = null;
  isModelLoaded: boolean = false;

  async install(modelMeta: { url: string; file: string }) {
    try {
        console.log(`Downloading model from ${modelMeta.url}...`);
        const path = await downloadModel(modelMeta.url, modelMeta.file);
        console.log(`Model downloaded to ${path}`);
        this.currentModelPath = path;
        
        console.log("Loading model into engine...");
        await loadModel(path);
        this.isModelLoaded = true;
        console.log("Model loaded successfully");
    } catch (error) {
        console.error("Failed to install/load model:", error);
        throw error;
    }
  }

  async load(path: string) {
      console.log(`Loading existing model from ${path}...`);
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
}

export const modelManager = new ModelManager();
