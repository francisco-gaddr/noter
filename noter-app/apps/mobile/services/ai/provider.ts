import { LLMProvider, ChatMessage } from '@repo/ai';
import * as FileSystem from 'expo-file-system/legacy';

// Lazy import to avoid crash if not linked
let llama: any;
try {
  llama = require('llama.rn');
} catch (e) {
  console.warn('llama.rn not found, AI features will be disabled');
}

export class MobileLlamaProvider implements LLMProvider {
  private context: any = null;

  private currentModelPath: string | null = null;

  async unloadModel(): Promise<void> {
    if (this.context) {
        try {
            // llama.rn may not have a formal release/unload, 
            // but we null it to trigger GC.
            // If the library provides a release method, call it here.
            this.context = null;
            this.currentModelPath = null;
            console.log("Model context cleared");
        } catch (e) {
            console.error("Failed to unload model:", e);
        }
    }
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!llama || typeof llama.initLlama !== 'function') {
      throw new Error("llama.rn not available");
    }
    
    // If already loaded same model, return
    if (this.context && this.currentModelPath === modelPath) return;

    // If a different model is loaded, unload it first
    if (this.context) {
        await this.unloadModel();
    }

    // Check file existence
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    if (!fileInfo.exists) {
        throw new Error(`Model file not found at ${modelPath}`);
    }

    try {
      this.context = await llama.initLlama({
        model: modelPath,
        use_mlock: true,
        n_ctx: 2048,
        n_gpu_layers: 0 // CPU fallback for reliability, 
                        // could be increased if device supports Metal/Vulkan
      });
      if (!this.context) {
        throw new Error("Failed to initialize model context");
      }
      this.currentModelPath = modelPath;
      console.log("Model loaded successfully:", modelPath);
    } catch (error) {
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  private formatPrompt(messages: ChatMessage[]): string {
    return messages.map(m => {
        const role = m.role === 'user' ? 'User' : (m.role === 'system' ? 'System' : 'Assistant');
        return `${role}: ${m.content}`;
    }).join('\n') + '\nAssistant:';
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    if (!this.context) throw new Error("Model not loaded");

    const prompt = this.formatPrompt(messages);

    const result = await this.context.completion({
        prompt,
        n_predict: 512,
        stop: ['User:', 'Assistant:'] // Stop generation when it tries to impersonate
    });
    
    return result.text.trim();
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    if (!this.context) throw new Error("Model not loaded");
    
    const prompt = this.formatPrompt(messages);

    await this.context.completion({
        prompt,
        n_predict: 512,
        stop: ['User:', 'Assistant:'],
        emit_partial_completion: true
    }, (data: any) => {
        if (onToken) onToken(data.token);
    });
  }
}
