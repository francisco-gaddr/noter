import { Tool } from './tools';
import { MCPClient } from './mcp';

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
  loadModel?(modelPath: string, options?: { gpuLayers?: number }): Promise<void>;
}

export class AIAgent {
  private tools: Map<string, Tool> = new Map();
  private mcpClients: MCPClient[] = [];

  constructor(private provider: LLMProvider) {}

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  registerMCP(client: MCPClient) {
    this.mcpClients.push(client);
  }

  async process(input: string, history: ChatMessage[] = []): Promise<ChatMessage[]> {
    const newMessages: ChatMessage[] = [
      { role: 'user', content: input }
    ];
    
    const messages: ChatMessage[] = [
      ...history,
      ...newMessages
    ];

    let response = await this.provider.generateResponse(messages);
    
    // Check for tool calls (max depth 5)
    for (let i = 0; i < 5; i++) {
        const toolCall = this.parseToolCall(response);
        if (!toolCall) break;

        const { tool, arguments: args } = toolCall;
        
        // Add assistant message (tool request)
        const assistantMsg: ChatMessage = { role: 'assistant', content: response };
        messages.push(assistantMsg);
        newMessages.push(assistantMsg);

        let result: any;
        try {
            result = await this.executeTool(tool, args);
        } catch (error) {
            result = { error: String(error) };
        }

        // Add tool result
        const toolMsg: ChatMessage = { 
            role: 'tool', 
            content: JSON.stringify(result),
            toolCallId: tool
        };
        messages.push(toolMsg);
        newMessages.push(toolMsg);

        // Generate next response
        response = await this.provider.generateResponse(messages);
    }

    const finalMsg: ChatMessage = { role: 'assistant', content: response };
    newMessages.push(finalMsg);
    
    return newMessages;
  }

  private parseToolCall(text: string): { tool: string, arguments: any } | null {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            const data = JSON.parse(match[0]);
            if (data.tool && data.arguments) {
                return data;
            }
        }
    } catch {
        // Ignore
    }
    return null;
  }

  private async executeTool(name: string, args: any): Promise<any> {
    if (this.tools.has(name)) {
        return this.tools.get(name)!.execute(args);
    }

    for (const client of this.mcpClients) {
        try {
            const tools = await client.listTools();
            if (tools.some(t => t.name === name)) {
                return await client.callTool(name, args);
            }
        } catch (e) {
            console.error(`MCP error for tool ${name}`, e);
        }
    }
    
    throw new Error(`Tool ${name} not found`);
  }
}

export * from './hf';
export * from './tools';
export * from './mcp';
export * from './gguf';
