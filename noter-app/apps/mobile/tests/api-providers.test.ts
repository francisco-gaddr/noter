import { generateApiProviderResponse, resolveChatCompletionsUrl, API_PROVIDERS, API_PROVIDER_LIST } from '../services/ai/apiProviders';

describe('mobile apiProviders', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('exposes all built-in providers (incl. OpenAI, Anthropic, Grok) in the registry', () => {
    expect(API_PROVIDER_LIST.map((p) => p.id).sort()).toEqual(
      ['anthropic', 'gemini', 'grok', 'groq', 'hermes', 'openai', 'openrouter']
    );
    expect(API_PROVIDERS.groq.endpoint).toContain('api.groq.com');
    expect(API_PROVIDERS.openai.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(API_PROVIDERS.openai.format).toBe('openai');
    expect(API_PROVIDERS.grok.endpoint).toBe('https://api.x.ai/v1/chat/completions');
    expect(API_PROVIDERS.anthropic.endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(API_PROVIDERS.anthropic.format).toBe('anthropic');
    expect(API_PROVIDERS.hermes.configurableEndpoint).toBe(true);
    expect(API_PROVIDERS.hermes.apiKeyOptional).toBe(true);
  });

  it('routes OpenAI + Grok through the OpenAI-compatible path with a Bearer token', async () => {
    for (const [provider, host] of [['openai', 'https://api.openai.com/v1/chat/completions'], ['grok', 'https://api.x.ai/v1/chat/completions']] as const) {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: `hi ${provider}` } }], usage: { total_tokens: 5 } }) });
      global.fetch = fetchMock as any;
      const result = await generateApiProviderResponse({
        provider, apiKey: 'key123', model: 'm',
        history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
      });
      expect(result.text).toBe(`hi ${provider}`);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(host);
      expect((init.headers as any).Authorization).toBe('Bearer key123');
    }
  });

  it('routes Anthropic through /v1/messages with x-api-key, version, system + content blocks', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Hej Claude' }], usage: { input_tokens: 10, output_tokens: 7 } }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'anthropic',
      apiKey: 'sk-ant-xyz',
      model: 'claude-sonnet-4-6',
      history: [
        { id: 's', role: 'system', content: 'Du är hjälpsam', createdAt: new Date().toISOString() },
        { id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
      ],
    });
    expect(result.text).toBe('Hej Claude');
    expect(result.totalTokens).toBe(17); // input + output
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as any)['x-api-key']).toBe('sk-ant-xyz');
    expect((init.headers as any)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse((init as any).body);
    expect(body.system).toBe('Du är hjälpsam');           // system is a top-level field
    expect(body.max_tokens).toBeGreaterThan(0);            // required by Anthropic
    expect(body.messages).toEqual([{ role: 'user', content: 'Hej' }]); // system stripped from messages
  });

  it('attaches images as Anthropic base64 image blocks on the last user turn', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }) });
    global.fetch = fetchMock as any;
    await generateApiProviderResponse({
      provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-haiku-latest',
      history: [{ id: '1', role: 'user', content: 'vad ser du?', createdAt: new Date().toISOString() }],
      images: ['data:image/png;base64,AAA'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const last = body.messages[body.messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
  });

  it('routes Groq through the OpenAI-compatible path with a Bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hej Groq' } }] }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'llama-3.3-70b-versatile',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('Hej Groq');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gsk_test' }) })
    );
  });

  it('normalises Hermes base URLs to /v1/chat/completions', () => {
    const meta = API_PROVIDERS.hermes;
    expect(resolveChatCompletionsUrl(meta, 'http://192.168.50.16:8080')).toBe('http://192.168.50.16:8080/v1/chat/completions');
    expect(resolveChatCompletionsUrl(meta, 'http://mac.local:1234/')).toBe('http://mac.local:1234/v1/chat/completions');
    expect(resolveChatCompletionsUrl(meta, 'http://mac.local:1234/v1')).toBe('http://mac.local:1234/v1/chat/completions');
    expect(resolveChatCompletionsUrl(meta, 'http://mac.local:1234/v1/chat/completions')).toBe('http://mac.local:1234/v1/chat/completions');
    expect(() => resolveChatCompletionsUrl(meta, '')).toThrow();
  });

  it('routes Hermes through the OpenAI path using the user base URL, no key required', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hej från Pi' } }], usage: { total_tokens: 12 } }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'hermes',
      apiKey: '',
      model: 'hermes-3-llama-3.1-8b',
      baseUrl: 'http://192.168.50.16:8080',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('Hej från Pi');
    expect(result.totalTokens).toBe(12);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.50.16:8080/v1/chat/completions');
    // No Authorization header when no key is provided (LAN server).
    expect((init.headers as any).Authorization).toBeUndefined();
  });

  it('sends a Bearer token for Hermes when a key IS provided', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    global.fetch = fetchMock as any;
    await generateApiProviderResponse({
      provider: 'hermes',
      apiKey: 'secret-token',
      model: 'hermes-3-llama-3.1-8b',
      baseUrl: 'http://mac.local:1234',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as any).Authorization).toBe('Bearer secret-token');
  });

  it('rejects a Hermes call with no base URL', async () => {
    await expect(
      generateApiProviderResponse({
        provider: 'hermes',
        apiKey: '',
        model: 'hermes-3-llama-3.1-8b',
        baseUrl: '',
        history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
      }),
    ).rejects.toThrow();
  });

  it('attaches images as OpenAI content-parts on the last user turn', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ser en katt' } }] }),
    });
    global.fetch = fetchMock as any;
    await generateApiProviderResponse({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'llama-vision',
      history: [{ id: '1', role: 'user', content: 'vad ser du?', createdAt: new Date().toISOString() }],
      images: ['data:image/png;base64,AAA'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const lastMsg = body.messages[body.messages.length - 1];
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(lastMsg.content[0]).toEqual({ type: 'text', text: 'vad ser du?' });
    expect(lastMsg.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
  });

  it('attaches images as Gemini inlineData', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    global.fetch = fetchMock as any;
    await generateApiProviderResponse({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.0-flash',
      history: [{ id: '1', role: 'user', content: 'beskriv', createdAt: new Date().toISOString() }],
      images: ['data:image/jpeg;base64,ZZZ'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const lastParts = body.contents[body.contents.length - 1].parts;
    expect(lastParts).toContainEqual({ inlineData: { mimeType: 'image/jpeg', data: 'ZZZ' } });
  });

  it('calls Gemini endpoint and merges text parts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hej ' }, { text: 'Gemini' }] } }],
        usageMetadata: { totalTokenCount: 42 },
      }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result.text).toBe('Hej Gemini');
    expect(result.totalTokens).toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'k' }) })
    );
  });
});
