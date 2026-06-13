import { generateApiProviderResponse, resolveChatCompletionsUrl, API_PROVIDERS } from '../services/ai/apiProviders';

describe('apiProviders', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls OpenRouter with auth header and returns assistant content', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hej från openrouter' } }], usage: { total_tokens: 42 } }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'openai/gpt-4o-mini',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('hej från openrouter');
    expect(result.totalTokens).toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    );
  });

  it('calls Groq via the shared OpenAI-compatible path', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'groq svar' } }] }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'groq',
      apiKey: 'gk',
      model: 'llama-3.3-70b-versatile',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('groq svar');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gk' }) })
    );
  });

  it('normalises a Hermes base URL to /v1/chat/completions', () => {
    expect(resolveChatCompletionsUrl(API_PROVIDERS.hermes, 'http://192.168.50.16:8080')).toBe(
      'http://192.168.50.16:8080/v1/chat/completions'
    );
    expect(resolveChatCompletionsUrl(API_PROVIDERS.hermes, 'http://host:1234/v1')).toBe(
      'http://host:1234/v1/chat/completions'
    );
  });
});
