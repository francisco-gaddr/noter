import { LLMProvider, ChatMessage } from '@repo/ai';
import { modelManager } from './ModelManager';

/**
 * Local on-device provider backed by llama.rn. The `messages` array is passed straight
 * to the model so its built-in chat template is applied — no hand-rolled "System: …"
 * prompt string. Streaming is real (native token callbacks), not a post-hoc split.
 */
export class MobileLlamaProvider implements LLMProvider {

  async unloadModel(): Promise<void> {
    await modelManager.unload();
  }

  async loadModel(modelPath: string, onProgress?: (progress: number) => void): Promise<void> {
    await modelManager.load(modelPath, onProgress);
  }

  /** True when this exact model is already resident (skip the load + its progress UI). */
  isLoaded(modelPath: string): boolean {
    return modelManager.isModelLoaded && modelManager.currentModelPath === modelPath;
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    return await modelManager.complete(messages, {
      nPredict: options?.maxTokens,
      temperature: options?.temperature,
      stop: options?.stop,
      shouldStop: options?.shouldStop,
    });
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    await modelManager.complete(messages, {
      onToken,
      nPredict: options?.maxTokens,
      temperature: options?.temperature,
      stop: options?.stop,
      shouldStop: options?.shouldStop,
    });
  }
}
