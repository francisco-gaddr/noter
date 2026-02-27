import { LLMProvider, ChatMessage } from '@repo/ai';
import * as FileSystem from 'expo-file-system';

// Lazy import to avoid crash if not linked
let llama: any;
try {
  llama = require('llama.rn');
} catch (e) {
  console.warn('llama.rn not found, AI features will be disabled');
}

export class MobileLlamaProvider implements LLMProvider {
  private context: any = null;

  async loadModel(modelPath: string): Promise<void> {
    if (!llama) throw new Error("llama.rn not available");
    
    if (this.context) return;

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
        n_gpu_layers: 0 // CPU fallback
      });
      console.log("Model loaded successfully");
    } catch (error) {
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    if (!this.context) throw new Error("Model not loaded");

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') throw new Error("Last message must be user");

    const result = await this.context.completion({
        prompt: lastMessage.content,
        n_predict: 512
    });
    
    return result.text;
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    if (!this.context) throw new Error("Model not loaded");
    const lastMessage = messages[messages.length - 1];

    await this.context.completion({
        prompt: lastMessage.content,
        n_predict: 512,
        emit_partial_completion: true
    }, (data: any) => {
        if (onToken) onToken(data.token);
    });
  }
}
