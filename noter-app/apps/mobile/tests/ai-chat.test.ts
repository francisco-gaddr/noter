import { MobileLlamaProvider } from '../services/ai/provider';

const mockLoad = jest.fn();
const mockUnload = jest.fn();
const mockComplete = jest.fn();

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: (...args: any[]) => mockLoad(...args),
    unload: (...args: any[]) => mockUnload(...args),
    complete: (...args: any[]) => mockComplete(...args),
  },
}));

describe('AI Chat Provider', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockUnload.mockReset();
    mockComplete.mockReset();
  });

  it('passes the messages array straight to the model (chat template applied natively)', async () => {
    const provider = new MobileLlamaProvider();
    mockComplete.mockResolvedValue('ok');
    const messages = [
      { id: 'u1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
      { id: 's1', role: 'system', content: 'Du är hjälpsam', createdAt: new Date().toISOString() },
      { id: 'a1', role: 'assistant', content: 'Hej', createdAt: new Date().toISOString() },
    ];
    const result = await provider.generateResponse(messages as any);
    expect(result).toBe('ok');
    // No hand-rolled prompt string — the raw messages are forwarded.
    expect(mockComplete.mock.calls[0][0]).toEqual(messages);
  });

  it('streams response via native onToken callbacks', async () => {
    const provider = new MobileLlamaProvider();
    mockComplete.mockImplementation(async (_messages: any, opts: any) => {
      'hej världen'.split('').forEach((ch) => opts.onToken?.(ch));
      return 'hej världen';
    });
    const chunks: string[] = [];
    await provider.streamResponse(
      [{ id: 'u1', role: 'user', content: 'Test', createdAt: new Date().toISOString() }] as any,
      {},
      (token) => chunks.push(token)
    );
    expect(chunks.join('')).toBe('hej världen');
  });
});
