import { AIAgent, Tool, LLMProvider, ChatMessage } from '../index';
import { z } from 'zod';

class MockProvider implements LLMProvider {
  async generateResponse(messages: ChatMessage[]): Promise<string> {
    const last = messages[messages.length - 1];
    
    // If user says "Create note", return tool call
    if (last.role === 'user' && last.content.includes('note')) {
        return JSON.stringify({ tool: 'create_note', arguments: { title: 'Test', content: 'Content' } });
    }
    
    // If previous message was a tool result, confirm creation
    if (last.role === 'tool' && last.toolCallId === 'create_note') {
        return "Note created successfully!";
    }
    
    return "Hello!";
  }
}

describe('AI Agent Integration', () => {
  it('should process input, execute tool, and return final response', async () => {
    const provider = new MockProvider();
    const agent = new AIAgent(provider);
    
    const mockExecute = jest.fn().mockResolvedValue({ success: true, id: '123' });
    const mockTool: Tool = {
        name: 'create_note',
        description: 'Create note',
        parameters: z.object({ title: z.string(), content: z.string() }),
        execute: mockExecute
    };
    
    agent.registerTool(mockTool);
    
    const newMessages = await agent.process('Create a note');
    
    expect(mockExecute).toHaveBeenCalledWith({ title: 'Test', content: 'Content' });
    const finalResponse = newMessages[newMessages.length - 1].content;
    expect(finalResponse).toBe("Note created successfully!");
  });
});
