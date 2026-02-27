import { z } from 'zod';

export * from './hf';
export * from './tools';
export * from './mcp';

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
  execute: (args: any) => Promise<any>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: any[];
}

export interface LLMProvider {
  generateResponse(messages: ChatMessage[], options?: any): Promise<string>;
  streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void>;
  loadModel(modelPath: string): Promise<void>;
}

export class AIAgent {
  private tools: Tool[] = [];
  private provider: LLMProvider;
  private systemPrompt: string = "You are a helpful AI assistant.";

  constructor(provider: LLMProvider, systemPrompt?: string) {
    this.provider = provider;
    if (systemPrompt) this.systemPrompt = systemPrompt;
  }

  registerTool(tool: Tool) {
    this.tools.push(tool);
  }

  async process(input: string, history: ChatMessage[] = []): Promise<string> {
    const toolsDescription = this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    const fullSystemPrompt = `${this.systemPrompt}\n\nAvailable tools:\n${toolsDescription}\n\nTo use a tool, respond with strictly JSON: {"tool": "tool_name", "arguments": { ... }}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...history,
      { role: 'user', content: input }
    ];

    const response = await this.provider.generateResponse(messages);

    // Basic JSON extraction for tool calling
    const jsonMatch = response.match(/\{[\s\S]*"tool"[\s\S]*"arguments"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const toolCall = JSON.parse(jsonMatch[0]);
        const tool = this.tools.find(t => t.name === toolCall.tool);
        if (tool) {
          // Execute tool
          const result = await tool.execute(toolCall.arguments);
          // Return tool result formatted
          // In a real loop, we would feed this back to the LLM.
          return `Tool '${tool.name}' executed.\nResult: ${JSON.stringify(result, null, 2)}`;
        }
      } catch (e) {
        console.error("Tool execution failed", e);
      }
    }

    return response;
  }
}
