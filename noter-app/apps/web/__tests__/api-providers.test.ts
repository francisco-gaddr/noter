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

  it('LM Studio resolves zero-config to its localhost default, and honours an override', () => {
    // No base URL → LM Studio's own default (localhost:1234).
    expect(resolveChatCompletionsUrl(API_PROVIDERS.lmstudio)).toBe('http://localhost:1234/v1/chat/completions');
    // A custom host/port still works and is normalised.
    expect(resolveChatCompletionsUrl(API_PROVIDERS.lmstudio, 'http://192.168.1.20:5000')).toBe(
      'http://192.168.1.20:5000/v1/chat/completions'
    );
  });

  it('Hermes (no default endpoint) still requires an explicit base URL', () => {
    expect(() => resolveChatCompletionsUrl(API_PROVIDERS.hermes)).toThrow(/Bas-URL saknas/);
  });

  it('calls LM Studio with NO Authorization header (local server, no key)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'lokalt svar' } }] }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'lmstudio',
      apiKey: '',
      model: 'qwen2.5-7b-instruct',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('lokalt svar');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect((init as any).headers).not.toHaveProperty('Authorization');
  });

  it('registers OpenAI, Anthropic and Grok', () => {
    expect(API_PROVIDERS.openai.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(API_PROVIDERS.grok.endpoint).toBe('https://api.x.ai/v1/chat/completions');
    expect(API_PROVIDERS.anthropic.endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(API_PROVIDERS.anthropic.format).toBe('anthropic');
  });

  it('calls Anthropic /v1/messages with x-api-key + system + content blocks', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Hej Claude' }], usage: { input_tokens: 4, output_tokens: 3 } }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-4-6',
      history: [
        { id: 's', role: 'system', content: 'Sys', createdAt: new Date().toISOString() },
        { id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
      ],
    });
    expect(result.text).toBe('Hej Claude');
    expect(result.totalTokens).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as any)['x-api-key']).toBe('sk-ant');
    const body = JSON.parse((init as any).body);
    expect(body.system).toBe('Sys');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hej' }]);
  });

  it('routes Grok through the OpenAI-compatible path with a Bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'hi grok' } }] }) });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'grok', apiKey: 'xai-key', model: 'grok-4.3',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('hi grok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect((init.headers as any).Authorization).toBe('Bearer xai-key');
  });
});
