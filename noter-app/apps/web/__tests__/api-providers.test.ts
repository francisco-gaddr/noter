import { generateApiProviderResponse } from '../services/ai/apiProviders';

describe('apiProviders', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls OpenRouter with auth header and returns assistant content', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hej från openrouter' } }] }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'openai/gpt-4o-mini',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result).toBe('hej från openrouter');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    );
  });
});
