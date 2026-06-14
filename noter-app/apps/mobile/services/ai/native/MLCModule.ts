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

/**
 * True only when a REAL on-device inference engine is linked (not the placeholder
 * bridge). We trust the native capability report: a genuine build exposes
 * `getLocalConversionCapabilities().engineAvailable === true`; the stub bridge lacks
 * the method (→ false). This lets the chat path be honest instead of returning a fake
 * "model reply" from the placeholder.
 */
export async function isLocalInferenceAvailable(): Promise<boolean> {
  if (!MLCModule || typeof MLCModule.generate !== 'function') return false;
  try {
    const caps = await getLocalConversionCapabilities();
    return !!caps.engineAvailable;
  } catch {
    return false;
  }
}

/** Honest, actionable message when on-device inference isn't built into this app. */
export const LOCAL_INFERENCE_UNAVAILABLE_MSG =
  'På-enheten-inferens är inte tillgänglig i den här appbygget (den lokala MLC/llama-motorn är inte inlänkad). ' +
  'Använd en Hermes-källa — din egen Ollama/LM Studio på Pi eller Mac — för lokal AI utan tredje part tills vidare.';

export async function chat(prompt: string) {
  if (!MLCModule) {
      throw new Error("MLCModule not linked");
  }
  // Never return the placeholder bridge's canned string as if it were a real reply.
  if (!(await isLocalInferenceAvailable())) {
    throw new Error(LOCAL_INFERENCE_UNAVAILABLE_MSG);
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
