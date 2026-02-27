import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import { LLMProvider, ChatMessage } from '@repo/ai';
import fs from 'fs';

// Singleton to hold the model in memory across API requests (serverless might kill it, but local dev persists)
let modelInstance: LlamaModel | null = null;
let contextInstance: LlamaContext | null = null;

export class NodeLlamaProvider implements LLMProvider {
  async loadModel(modelPath: string, options?: { gpuLayers?: number }): Promise<void> {
    // If model is already loaded, check if we need to reload with different settings
    if (modelInstance) {
        // Simple check: if gpuLayers option is provided, we assume user wants to enforce it.
        // In a real app, we'd check if current config matches.
        // For now, we dispose and reload if options are passed.
        if (options && options.gpuLayers !== undefined) {
             console.log("Reloading model with new options:", options);
             if (contextInstance) {
                 // LlamaContext doesn't have dispose method in newer versions, 
                 // it relies on GC or LlamaModel disposal? 
                 // Or we just null it. Let's null it for now as LlamaModel.dispose() handles resources.
                 contextInstance = null;
             }
             if (modelInstance) {
                 // modelInstance.dispose(); 
                 // LlamaModel also doesn't expose dispose in all versions, or it might be internal.
                 // Letting it be GC'd is safer if API changed.
                 modelInstance = null;
             }
        } else {
            return;
        }
    }

    if (!fs.existsSync(modelPath)) {
        throw new Error(`Model file not found at ${modelPath}`);
    }

    try {
      modelInstance = new LlamaModel({
        modelPath: modelPath,
        gpuLayers: options?.gpuLayers
      });
      contextInstance = new LlamaContext({ model: modelInstance });
      console.log("Model loaded successfully from", modelPath, "with options", options);
    } catch (error) {
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    if (!modelInstance || !contextInstance) throw new Error("Model not loaded");

    // Create a new session for this request context to handle history properly
    // TODO: Map ChatMessage[] to LlamaChatSession history format if needed
    const session = new LlamaChatSession({ context: contextInstance });

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') throw new Error("Last message must be user");

    // We only prompt with the last message for now, assuming history management happens via session
    // But since we create new session, we lose history unless we preload it.
    // For MVP, we just prompt.
    
    const response = await session.prompt(lastMessage.content);
    return response;
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    if (!modelInstance || !contextInstance) throw new Error("Model not loaded");

    const session = new LlamaChatSession({ context: contextInstance });
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage || lastMessage.role !== 'user') throw new Error("Last message must be user");

    await session.prompt(lastMessage.content, {
      onToken: (chunk) => {
        const token = session.context.decode(chunk);
        if (onToken) onToken(token);
      }
    });
  }
}
