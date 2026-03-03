import { MobileLlamaProvider } from '../services/ai/provider';

const mockLoad = jest.fn();
const mockUnload = jest.fn();
const mockChat = jest.fn();

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: (...args: any[]) => mockLoad(...args),
    unload: (...args: any[]) => mockUnload(...args),
    chat: (...args: any[]) => mockChat(...args),
  },
}));

describe('AI Chat Provider', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockUnload.mockReset();
    mockChat.mockReset();
  });

  it('formats prompt with system message first', async () => {
    const provider = new MobileLlamaProvider();
    mockChat.mockResolvedValue('ok');
    await provider.generateResponse([
      { id: 'u1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
      { id: 's1', role: 'system', content: 'Du är hjälpsam', createdAt: new Date().toISOString() },
      { id: 'a1', role: 'assistant', content: 'Hej', createdAt: new Date().toISOString() },
    ]);
    const prompt = mockChat.mock.calls[0][0];
    expect(prompt.startsWith('System: Du är hjälpsam')).toBe(true);
    expect(prompt).toContain('User: Hej');
  });

  it('streams response in chunks', async () => {
    const provider = new MobileLlamaProvider();
    mockChat.mockResolvedValue('hej världen');
    const chunks: string[] = [];
    await provider.streamResponse(
      [{ id: 'u1', role: 'user', content: 'Test', createdAt: new Date().toISOString() }],
      { streamDelayMs: 0 },
      (token) => chunks.push(token)
    );
    expect(chunks.join('')).toBe('hej världen');
  });
});
