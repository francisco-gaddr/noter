import { generateApiProviderResponse } from '../services/ai/apiProviders';

describe('mobile apiProviders', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls Gemini endpoint and merges text parts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hej ' }, { text: 'Gemini' }] } }],
      }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result).toBe('Hej Gemini');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'k' }) })
    );
  });

  it('passes system prompt separately to Gemini and preserves tool output', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Klar' }] } }],
      }),
    });
    global.fetch = fetchMock as any;

    await generateApiProviderResponse({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      history: [
        { id: 's1', role: 'system', content: 'Var hjälpsam', createdAt: new Date().toISOString() },
        { id: 'u1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
        { id: 't1', role: 'tool', content: 'found note', createdAt: new Date().toISOString() },
      ],
    });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as any).body);
    expect(body.systemInstruction.parts[0].text).toBe('Var hjälpsam');
    expect(body.contents[1].parts[0].text).toContain('Tool result');
  });

  it('calls OpenRouter endpoint and returns content', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hej OpenRouter' } }],
      }),
    });
    global.fetch = fetchMock as any;
    const result = await generateApiProviderResponse({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'openai/gpt-4o-mini',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    });
    expect(result).toBe('Hej OpenRouter');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    );
  });

  it('maps system and tool messages safely for OpenRouter', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hej OpenRouter' } }],
      }),
    });
    global.fetch = fetchMock as any;

    await generateApiProviderResponse({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'openai/gpt-4o-mini',
      history: [
        { id: 's1', role: 'system', content: 'Systemregel', createdAt: new Date().toISOString() },
        { id: 't1', role: 'tool', content: 'tool output', createdAt: new Date().toISOString() },
      ],
    });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as any).body);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'Systemregel' });
    expect(body.messages[1]).toMatchObject({ role: 'user' });
    expect(body.messages[1].content).toContain('Tool result');
  });

  it('throws provider error body when OpenRouter request fails', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => 'invalid key',
    });
    global.fetch = fetchMock as any;
    await expect(generateApiProviderResponse({
      provider: 'openrouter',
      apiKey: 'bad',
      model: 'openai/gpt-4o-mini',
      history: [{ id: '1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() }],
    })).rejects.toThrow('invalid key');
  });
});
