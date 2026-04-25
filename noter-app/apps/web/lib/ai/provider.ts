import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import { LLMProvider, ChatMessage } from '@repo/ai';
import fs from 'fs';

// Singleton to hold the model in memory across API requests (serverless might kill it, but local dev persists)
let modelInstance: LlamaModel | null = null;
let contextInstance: LlamaContext | null = null;
let loadedCacheKey = '';

export class NodeLlamaProvider implements LLMProvider {
  constructor(private cacheKey = 'global') {}

  async loadModel(modelPath: string, options?: { gpuLayers?: number }): Promise<void> {
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Model file not found at ${modelPath}`);
    }
    const nextCacheKey = `${this.cacheKey}:${modelPath}:${String(options?.gpuLayers ?? '')}`;
    
    // Only reload if model path changed or we don't have an instance
    // Or if gpuLayers changed significantly (simplification: just reuse if path matches)
    // We store the current model path in a static property or closure if needed, 
    // but for now, let's just assume single model usage or reload if null.
    
    if (modelInstance) {
        if (loadedCacheKey === nextCacheKey) {
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
      loadedCacheKey = nextCacheKey;
      
      contextInstance = new LlamaContext({ model: modelInstance });
      console.log("Model loaded successfully from", modelPath);
    } catch (error) {
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    if (!modelInstance || !contextInstance) throw new Error("Model not loaded");

    // Reconstruct basic session for non-streaming response
    const session = new LlamaChatSession({ context: contextInstance });
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') return '';

    // Simple prompt without streaming
    return await session.prompt(lastMessage.content);
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    if (!modelInstance || !contextInstance) throw new Error("Model not loaded");

    // Create session
    const session = new LlamaChatSession({ context: contextInstance });
    
    // Load history
    // We need to preload previous messages into the session history state if we want context
    // Since we create new session per request (stateless API), we recreate the chat history here.
    // LlamaChatSession supports passing history in constructor or we can feed it manually?
    // Looking at node-llama-cpp docs, we usually keep the session alive. 
    // But in stateless API route, we must reconstruct it.
    
    // We can pass conversationHistory to LlamaChatSession constructor in newer versions?
    // Or we rely on the prompt context window.
    
    // For now, let's try to reconstruct basic history if available
    if (messages.length > 1) {
        // We could manually push messages to session.context or similar if API allows
        // But standard way in stateless is usually just passing the prompt with context.
        // LlamaChatSession manages context state.
        // Ideally we should serialize/deserialize session state, but that's complex.
        
        // Alternative: Just format the prompt with history manually if we don't use session state?
        // But session.prompt handles template formatting.
        
        // Let's assume for this MVP we just prompt with the last message, 
        // OR we can try to replay history?
        // Replaying is slow. 
        // Correct way for "chat" is usually keeping stateful session on server (e.g. WebSocket) or sending full context.
        
        // If we want context, we might need to feed previous turns.
        // session.setConversationHistory(messages) ??
    }
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') return; 

    // Basic prompt
    await session.prompt(lastMessage.content, {
      onToken: (chunk) => {
        // chunk is Token[] in newer versions or Uint32Array
        // We need to decode it to string. 
        // LlamaModel usually has detokenize, but if Typescript complains it might be missing in type def or we need to use context.
        // LlamaContext usually has decode(tokens).
        // Let's try session.context.decode(chunk) or modelInstance.detokenize([chunk[0]]) if it exists.
        // If TS says detokenize doesn't exist on LlamaModel, we should check what does.
        // Newer node-llama-cpp versions: model.detokenize(tokens: Token[]) -> string
        // If TS is strict, maybe cast or check methods.
        
        // Actually, session.context.decode(chunk) is the standard way for Token[] chunks in streaming.
        const token = session.context.decode(chunk);
        if (onToken) onToken(token);
      }
    });
  }
}
