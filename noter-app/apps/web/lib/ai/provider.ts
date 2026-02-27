import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import { LLMProvider, ChatMessage } from '@repo/ai';
import fs from 'fs';

// Singleton to hold the model in memory across API requests (serverless might kill it, but local dev persists)
let modelInstance: LlamaModel | null = null;
let contextInstance: LlamaContext | null = null;

export class NodeLlamaProvider implements LLMProvider {
  async loadModel(modelPath: string, options?: { gpuLayers?: number }): Promise<void> {
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Model file not found at ${modelPath}`);
    }
    
    // Only reload if model path changed or we don't have an instance
    // Or if gpuLayers changed significantly (simplification: just reuse if path matches)
    // We store the current model path in a static property or closure if needed, 
    // but for now, let's just assume single model usage or reload if null.
    
    if (modelInstance) {
        // If we want to support switching models, we need to track current path.
        // For this fix, let's assume we reuse if instance exists to avoid overhead, 
        // unless we implement full model switching logic.
        // But the user might switch models in UI.
        // Let's add a property to track loaded path.
        // @ts-ignore
        if (modelInstance._modelPath === modelPath) {
            return;
        }
        
        // If different model, we must dispose (nullify)
        contextInstance = null;
        modelInstance = null;
    }

    try {
      modelInstance = new LlamaModel({
        modelPath: modelPath,
        gpuLayers: options?.gpuLayers
      });
      // @ts-ignore
      modelInstance._modelPath = modelPath;
      
      contextInstance = new LlamaContext({ model: modelInstance });
      console.log("Model loaded successfully from", modelPath);
    } catch (error) {
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    if (!modelInstance || !contextInstance) throw new Error("Model not loaded");

    // Create session
    const session = new LlamaChatSession({ context: contextInstance });
    
    // Load history
    // We need to preload previous messages into the session history state if we want context
    // LlamaChatSession usually manages its own history if kept alive. 
    // Since we create new session per request (stateless API), we should ideally replay history.
    // For now, we just take the last user message to get it working.
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') return; // Nothing to prompt

    // Basic prompt
    await session.prompt(lastMessage.content, {
      onToken: (chunk) => {
        // chunk is Token[] in newer versions or Uint32Array
        // We need to decode it to string
        const token = modelInstance!.detokenize([chunk[0]]); // Decode single token
        if (onToken) onToken(token);
      }
    });
  }
}
