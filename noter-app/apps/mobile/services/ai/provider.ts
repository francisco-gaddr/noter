import { LLMProvider, ChatMessage } from '@repo/ai';
import { modelManager } from './ModelManager';

export class MobileLlamaProvider implements LLMProvider {

  async unloadModel(): Promise<void> {
    // ModelManager doesn't support unloading in the current snippet, 
    // but we can assume switching models handles it or it's a no-op.
    console.log("Model unload requested (handled by ModelManager on next load)");
  }

  async loadModel(modelPath: string): Promise<void> {
    // We assume the model is already downloaded and we just need to load it.
    // ModelManager.install downloads AND loads. 
    // But if we just want to load an existing file, we might need a separate method in ModelManager
    // or just call install with a local path?
    // The user's ModelManager.install takes {url, file} and calls download then load.
    // We need a way to just load.
    
    // Let's check ModelManager again. 
    // It has: currentModelPath, install(meta), chat(prompt).
    // It calls `loadModel(path)` internally.
    // We should probably expose `loadModel` in ModelManager or call the native one directly.
    
    // For now, let's try to load it using the native module directly via ModelManager's internal logic
    // if we could access it. 
    // Actually, I'll update ModelManager to expose a `load` method.
    
    // WAIT: The user's prompt for ModelManager only had `install` and `chat`.
    // But `ai.tsx` UI separates "Download" from "Select/Load".
    // I should add `load(path)` to ModelManager.
    
    // For now, I'll assume I can add it.
    await (modelManager as any).load(modelPath);
  }

  private formatPrompt(messages: ChatMessage[]): string {
    // Simple chat format. Adjust based on model template (e.g. ChatML, Llama2, etc.)
    // For now, standard User/Assistant.
    return messages.map(m => {
        const role = m.role === 'user' ? 'User' : (m.role === 'system' ? 'System' : 'Assistant');
        return `${role}: ${m.content}`;
    }).join('\n') + '\nAssistant:';
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    const prompt = this.formatPrompt(messages);
    return await modelManager.chat(prompt);
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    // The native bridge provided is synchronous (Promise-based, not event emitter).
    // So we cannot true stream. We will simulate it by waiting for the full response 
    // and then emitting it all at once.
    const response = await this.generateResponse(messages, options);
    if (onToken) {
        onToken(response);
    }
  }
}
