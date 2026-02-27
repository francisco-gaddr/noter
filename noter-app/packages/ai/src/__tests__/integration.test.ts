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
    
    agent.registerTool(mockTool);
    
    const response = await agent.process('Create a note');
    
    expect(mockTool.execute).toHaveBeenCalledWith({ title: 'Test', content: 'Content' });
    expect(response).toContain('Tool \'create_note\' executed');
  });
});
