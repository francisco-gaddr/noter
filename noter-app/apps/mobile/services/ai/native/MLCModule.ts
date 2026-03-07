import { NativeModules } from "react-native";

const { MLCModule } = NativeModules;

export const canConvertLocally = () => {
  return !!MLCModule
    && typeof MLCModule.convertGGUFToMLC === 'function'
    && typeof MLCModule.getLocalConversionCapabilities === 'function';
};

export async function loadModel(path: string) {
  if (!MLCModule) {
      console.warn("MLCModule is not linked. Make sure to rebuild the native app.");
      return;
  }
  return MLCModule.loadModel(path);
}

export async function chat(prompt: string) {
  if (!MLCModule) {
      throw new Error("MLCModule not linked");
  }
  return MLCModule.generate(prompt);
}

export async function unloadModel() {
  if (!MLCModule) return;
  if (typeof MLCModule.unloadModel === 'function') {
      return MLCModule.unloadModel();
  }
}

export async function convertGGUFToMLC(inputPath: string, outputPath: string, quantization: string, platform: 'iphone' | 'android') {
  if (!MLCModule || typeof MLCModule.convertGGUFToMLC !== 'function') {
    throw new Error('Local conversion unsupported');
  }
  return MLCModule.convertGGUFToMLC(inputPath, outputPath, quantization, platform);
}

export async function getLocalConversionCapabilities(): Promise<{
  engineAvailable: boolean;
  converterAvailable: boolean;
  engineClass?: string;
  converterClass?: string;
  converterMethod?: string;
  engineError?: string;
  converterError?: string;
}> {
  if (!MLCModule || typeof MLCModule.getLocalConversionCapabilities !== 'function') {
    return { engineAvailable: false, converterAvailable: false, converterError: 'MLCModule not linked' };
  }
  return MLCModule.getLocalConversionCapabilities();
}

export async function runLocalConversionSelfTest(inputPath: string, outputPath: string, quantization: string) {
  if (!MLCModule || typeof MLCModule.runLocalConversionSelfTest !== 'function') {
    throw new Error('Local conversion self-test unsupported');
  }
  return MLCModule.runLocalConversionSelfTest(inputPath, outputPath, quantization);
}
