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
});
