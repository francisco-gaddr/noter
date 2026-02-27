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
}

export interface LLMProvider {
  generateResponse(messages: ChatMessage[]): Promise<string>;
  streamResponse?(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
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
export * from './mcp';
