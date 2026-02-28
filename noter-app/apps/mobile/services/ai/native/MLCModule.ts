import { NativeModules } from "react-native";

const { MLCModule } = NativeModules;

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
