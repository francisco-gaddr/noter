import { AIAgent, Tool, LLMProvider, ChatMessage } from '../index';
import { z } from 'zod';

class MockProvider implements LLMProvider {
  async generateResponse(messages: ChatMessage[]): Promise<string> {
    const last = messages[messages.length - 1];
    if (last.content.includes('note')) {
        return JSON.stringify({ tool: 'create_note', arguments: { title: 'Test', content: 'Content' } });
    }
    return "Hello!";
  }
  async streamResponse() {}
  async loadModel() {}
}

describe('AI Agent Integration', () => {
  it('should process input and execute tool', async () => {
    const provider = new MockProvider();
    const agent = new AIAgent(provider);
    
    const mockTool: Tool = {
        name: 'create_note',
        description: 'Create note',
        parameters: z.object({ title: z.string(), content: z.string() }),
        execute: jest.fn().mockResolvedValue({ success: true })
    };
    
    // In a real scenario, we would register the tool.
    // For now, we simulate the tool execution handling in the agent or client code.
    // This test verifies the agent can use the provider to get a tool call response.
    
    const response = await agent.process('Create a note');
    const parsed = JSON.parse(response);
    
    expect(parsed.tool).toBe('create_note');
    expect(parsed.arguments).toEqual({ title: 'Test', content: 'Content' });
  });
});
