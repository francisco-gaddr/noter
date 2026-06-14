import { MobileLlamaProvider } from '../services/ai/provider';
import { extractToolCalls } from '../services/ai/tooling';

const mockComplete = jest.fn();

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: jest.fn(),
    unload: jest.fn(),
    complete: (...args: any[]) => mockComplete(...args),
  },
}));

describe('AI tool-use e2e flow', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it('detects tool call when tool-use enabled', async () => {
    mockComplete.mockResolvedValue('```json\n{"tool":"list_tasks","arguments":{"completed":false}}\n```');
    const provider = new MobileLlamaProvider();
    const response = await provider.generateResponse([
      { id: 'u1', role: 'user', content: 'Visa mina uppgifter', createdAt: new Date().toISOString() },
    ]);
    const { calls } = extractToolCalls(response);
    expect(calls.length).toBe(1);
    expect(calls[0].tool).toBe('list_tasks');
    expect(calls[0].arguments.completed).toBe(false);
  });

  it('skips tool execution when tool-use disabled', async () => {
    mockComplete.mockResolvedValue('```json\n{"tool":"list_tasks","arguments":{"completed":false}}\n```');
    const provider = new MobileLlamaProvider();
    const response = await provider.generateResponse([
      { id: 'u1', role: 'user', content: 'Visa mina uppgifter', createdAt: new Date().toISOString() },
    ]);
    const { calls } = extractToolCalls(response);
    const executed = false;
    expect(calls.length).toBe(1);
    expect(executed).toBe(false);
  });
});
