import {
  SseBuffer,
  sseDataPayloads,
  openAiDelta,
  openAiUsageTokens,
  geminiDelta,
  geminiUsageTokens,
} from '../services/ai/sseParser';

describe('SseBuffer', () => {
  it('emits complete lines and keeps the partial tail across chunks', () => {
    const b = new SseBuffer();
    expect(b.push('data: a\nda')).toEqual(['data: a']);
    expect(b.push('ta: b\n')).toEqual(['data: b']);
    expect(b.flush()).toEqual([]);
  });

  it('flushes a trailing un-terminated line', () => {
    const b = new SseBuffer();
    expect(b.push('data: x')).toEqual([]);
    expect(b.flush()).toEqual(['data: x']);
  });

  it('handles CRLF line endings', () => {
    const b = new SseBuffer();
    expect(b.push('data: a\r\ndata: b\r\n')).toEqual(['data: a', 'data: b']);
  });
});

describe('sseDataPayloads', () => {
  it('extracts only data: payloads, dropping blanks and comments', () => {
    expect(sseDataPayloads(['data: {"x":1}', '', ': comment', 'event: ping'])).toEqual(['{"x":1}']);
  });
});

describe('openAiDelta / usage', () => {
  it('returns incremental content', () => {
    expect(openAiDelta(JSON.stringify({ choices: [{ delta: { content: 'Hej' } }] }))).toBe('Hej');
  });
  it('returns "" for a content-less keepalive chunk and null for [DONE]', () => {
    expect(openAiDelta(JSON.stringify({ choices: [{ delta: {} }] }))).toBe('');
    expect(openAiDelta('[DONE]')).toBeNull();
  });
  it('returns null for malformed JSON', () => {
    expect(openAiDelta('{not json')).toBeNull();
  });
  it('reads usage.total_tokens when present', () => {
    expect(openAiUsageTokens(JSON.stringify({ usage: { total_tokens: 99 } }))).toBe(99);
    expect(openAiUsageTokens('[DONE]')).toBe(0);
  });

  it('reconstructs a full message from a stream of chunks', () => {
    const chunks = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hej ' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Groq' } }] }),
      'data: ' + JSON.stringify({ usage: { total_tokens: 12 } }),
      'data: [DONE]',
    ];
    let text = '';
    let tokens = 0;
    for (const p of sseDataPayloads(chunks)) {
      const d = openAiDelta(p);
      if (d) text += d;
      tokens = openAiUsageTokens(p) || tokens;
    }
    expect(text).toBe('Hej Groq');
    expect(tokens).toBe(12);
  });
});

describe('geminiDelta / usage', () => {
  it('concatenates text parts', () => {
    expect(geminiDelta(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }))).toBe('ab');
  });
  it('returns "" for malformed payloads', () => {
    expect(geminiDelta('nope')).toBe('');
  });
  it('reads usageMetadata.totalTokenCount', () => {
    expect(geminiUsageTokens(JSON.stringify({ usageMetadata: { totalTokenCount: 7 } }))).toBe(7);
  });
});
