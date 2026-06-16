export interface ChatMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt?: string;
  toolCalls?: any[];
  toolCallId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  model?: string;
  projectId?: string | null;
  icon?: string;
  iconColor?: string;
}

export interface AIProject {
  id: string;
  name: string;
  systemPrompt?: string;
  icon?: string;
  iconColor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LLMProvider {
  generateResponse(messages: ChatMessage[], options?: any): Promise<string>;
  streamResponse?(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void>;
  // Second arg is implementation-specific: mobile passes an onProgress callback
  // (0..1 load progress); the Node provider passes { gpuLayers }. Kept loose so both fit.
  loadModel?(modelPath: string, onProgressOrOptions?: ((progress: number) => void) | { gpuLayers?: number }): Promise<void>;
}

export class AIAgent {
  constructor(private provider: LLMProvider) {}

  async process(input: string, history: ChatMessage[] = []): Promise<string> {
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: input }
    ];
    return this.provider.generateResponse(messages);
  }
}

export * from './hf';
export * from './tools';
export * from './toolArgs';
export * from './agentRunner';
export * from './mcp';
