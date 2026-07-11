import { fetch as expoFetch } from 'expo/fetch';
import { streamApiProviderResponse } from '../services/ai/apiProviders';

/**
 * Integration coverage for the on-device streaming path (previously ZERO coverage — expo/fetch was
 * mocked to a bare jest.fn). We drive a FAKE expo/fetch that returns a real getReader() emitting SSE
 * byte chunks, so the whole wiring runs: reader loop, TextDecoder({stream:true}), SSE parsing,
 * onToken, multibyte reassembly, and the non-streaming fallback.
 */
const mockExpoFetch = expoFetch as unknown as jest.Mock;

const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A minimal streaming Response whose reader yields the given byte chunks in order. */
const streamResponse = (chunks: Uint8Array[]) => {
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
    text: async () => '',
  };
};

const userMsg = { id: '1', role: 'user' as const, content: 'hi', createdAt: new Date().toISOString() };

describe('streamApiProviderResponse — integration (OpenAI format)', () => {
  afterEach(() => mockExpoFetch.mockReset());

  it('emits each delta via onToken and returns the full text', async () => {
    mockExpoFetch.mockResolvedValue(
      streamResponse([
        bytes(sse({ choices: [{ delta: { content: 'Hej' } }] })),
        bytes(sse({ choices: [{ delta: { content: ' där' } }] })),
        bytes(sse({ choices: [{ delta: { content: '!' } }] })),
        bytes('data: [DONE]\n\n'),
      ]),
    );
    const tokens: string[] = [];
    const res = await streamApiProviderResponse({
      provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: [userMsg],
      onToken: (d) => tokens.push(d),
    });
    expect(tokens.join('')).toBe('Hej där!');
    expect(res.text).toBe('Hej där!');
  });

  it('reassembles a multibyte char split across two reader chunks (emoji not garbled)', async () => {
    const payload = bytes(sse({ choices: [{ delta: { content: '🚀' } }] }));
    // Split the payload bytes inside the emoji's 4-byte sequence so the decoder must buffer.
    const mid = payload.indexOf(0xf0); // start of the 4-byte 🚀 lead byte
    mockExpoFetch.mockResolvedValue(
      streamResponse([payload.slice(0, mid + 2), payload.slice(mid + 2), bytes('data: [DONE]\n\n')]),
    );
    let out = '';
    const res = await streamApiProviderResponse({
      provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: [userMsg], onToken: (d) => { out += d; },
    });
    expect(out).toBe('🚀');
    expect(res.text).toBe('🚀');
  });

  it('on a non-2xx response throws (caller shows an error / falls back), not a silent hang', async () => {
    mockExpoFetch.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null }, text: async () => 'rate limited' });
    await expect(
      streamApiProviderResponse({ provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: [userMsg], onToken: () => {} }),
    ).rejects.toBeTruthy();
  });

  it('does NOT send stream_options to a self-hosted Hermes provider (avoids the 400)', async () => {
    mockExpoFetch.mockResolvedValue(streamResponse([bytes('data: [DONE]\n\n')]));
    await streamApiProviderResponse({
      provider: 'hermes', apiKey: '', model: 'llama', baseUrl: 'http://localhost:1234', history: [userMsg], onToken: () => {},
    });
    const body = JSON.parse((mockExpoFetch.mock.calls[0][1] as any).body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toBeUndefined();
  });

  it('DOES send stream_options to OpenAI (usage accounting works there)', async () => {
    mockExpoFetch.mockResolvedValue(streamResponse([bytes('data: [DONE]\n\n')]));
    await streamApiProviderResponse({ provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', history: [userMsg], onToken: () => {} });
    const body = JSON.parse((mockExpoFetch.mock.calls[0][1] as any).body);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});
