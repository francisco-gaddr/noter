import { normalizeEmbeddingsUrl, buildEmbeddingsBody, parseEmbeddingsResponse, embedTexts } from './embeddingsClient';

describe('normalizeEmbeddingsUrl', () => {
  it('lands on /v1/embeddings from a bare host, a /v1 root, or a full path', () => {
    expect(normalizeEmbeddingsUrl('http://192.168.50.16:11434')).toBe('http://192.168.50.16:11434/v1/embeddings');
    expect(normalizeEmbeddingsUrl('http://host:1234/v1')).toBe('http://host:1234/v1/embeddings');
    expect(normalizeEmbeddingsUrl('http://host/v1/embeddings/')).toBe('http://host/v1/embeddings');
  });
  it('throws on an empty base url', () => {
    expect(() => normalizeEmbeddingsUrl('  ')).toThrow();
  });
});

describe('buildEmbeddingsBody + parseEmbeddingsResponse', () => {
  it('builds an OpenAI-shaped body', () => {
    expect(JSON.parse(buildEmbeddingsBody('nomic-embed-text', ['a', 'b']))).toEqual({ model: 'nomic-embed-text', input: ['a', 'b'] });
  });
  it('parses vectors and reorders by index', () => {
    const json = { data: [{ index: 1, embedding: [0.2, 0.3] }, { index: 0, embedding: [0.1, 0.4] }] };
    expect(parseEmbeddingsResponse(json, 2)).toEqual([[0.1, 0.4], [0.2, 0.3]]);
  });
  it('returns [] on a malformed shape', () => {
    expect(parseEmbeddingsResponse({}, 1)).toEqual([]);
    expect(parseEmbeddingsResponse({ data: 'x' })).toEqual([]);
  });
});

describe('embedTexts', () => {
  it('posts to the url and returns vectors', async () => {
    const calls: any[] = [];
    const fakeFetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }) } as any;
    }) as unknown as typeof fetch;
    const out = await embedTexts({ url: 'http://h/v1/embeddings', model: 'm', inputs: ['hi'], apiKey: 'k', fetchImpl: fakeFetch });
    expect(out).toEqual([[1, 2, 3]]);
    expect(calls[0].url).toBe('http://h/v1/embeddings');
    expect(calls[0].init.headers.Authorization).toBe('Bearer k');
  });
  it('returns [] for empty inputs without calling fetch', async () => {
    let called = false;
    const fakeFetch = (async () => { called = true; return { ok: true, json: async () => ({}) } as any; }) as unknown as typeof fetch;
    expect(await embedTexts({ url: 'x', model: 'm', inputs: [], fetchImpl: fakeFetch })).toEqual([]);
    expect(called).toBe(false);
  });
  it('throws on a non-ok response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 500, text: async () => 'boom' }) as any) as unknown as typeof fetch;
    await expect(embedTexts({ url: 'x', model: 'm', inputs: ['a'], fetchImpl: fakeFetch })).rejects.toThrow('boom');
  });
  it('retries a transient 503 then succeeds (self-hosted endpoint warming up)', async () => {
    let n = 0;
    const fakeFetch = (async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 503, text: async () => 'warming up' } as any;
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [9, 9] }] }) } as any;
    }) as unknown as typeof fetch;
    const out = await embedTexts({ url: 'x', model: 'm', inputs: ['a'], fetchImpl: fakeFetch });
    expect(out).toEqual([[9, 9]]);
    expect(n).toBe(2); // one retry
  });
});
