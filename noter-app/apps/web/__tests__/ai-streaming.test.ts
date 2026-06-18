import { streamApiProviderResponse } from '../services/ai/apiProviders';

/**
 * Streaming resilience: a provider that emits some tokens and then drops the
 * connection must KEEP what it already streamed and never silently re-run the whole
 * prompt (which would duplicate the visible answer and re-bill the tokens). A user
 * cancel must propagate, not fall back.
 */
const enc = new TextEncoder();
const userTurn = [{ id: '1', role: 'user' as const, content: 'Hej', createdAt: new Date().toISOString() }];

const makeStreamingResponse = (read: () => Promise<{ done: boolean; value?: Uint8Array }>) => ({
  ok: true,
  body: { getReader: () => ({ read, cancel: async () => {} }) },
});

describe('web streamApiProviderResponse resilience', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('keeps the partial answer (no duplicate, no re-request) when the stream breaks mid-flight', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'];
    let i = 0;
    const read = jest.fn(async () => {
      if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
      throw new Error('stream broke'); // network hiccup AFTER a token was emitted
    });
    const fetchMock = jest.fn(async () => makeStreamingResponse(read));
    global.fetch = fetchMock as unknown as typeof fetch;

    const tokens: string[] = [];
    const result = await streamApiProviderResponse({
      provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: userTurn,
      onToken: (d) => tokens.push(d),
    });

    expect(tokens.join('')).toBe('Hello');
    expect(result.text).toBe('Hello');
    // Crucially: exactly ONE request — it did NOT fall back to a second (duplicating) call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a user cancel mid-stream instead of falling back', async () => {
    const controller = new AbortController();
    const read = jest.fn(async () => {
      controller.abort(); // user hit stop while the stream was open
      throw new DOMException('Aborted', 'AbortError');
    });
    const fetchMock = jest.fn(async () => makeStreamingResponse(read));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      streamApiProviderResponse({
        provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: userTurn,
        onToken: () => {}, signal: controller.signal,
      }),
    ).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second (fallback) request
  });

  it('falls back to a single non-streaming response when the stream yields nothing', async () => {
    let call = 0;
    const fetchMock = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        // streaming attempt: connection opens but the body errors before any token
        return makeStreamingResponse(async () => { throw new Error('no body'); });
      }
      // non-streaming fallback
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'full answer' } }], usage: { total_tokens: 7 } }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const tokens: string[] = [];
    const result = await streamApiProviderResponse({
      provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: userTurn,
      onToken: (d) => tokens.push(d),
    });

    expect(result.text).toBe('full answer');
    expect(tokens.join('')).toBe('full answer');
    expect(fetchMock).toHaveBeenCalledTimes(2); // stream attempt + one fallback
  });
});
