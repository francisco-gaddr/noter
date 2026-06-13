import { extractThinking, hasThinking } from '../services/ai/thinking';

describe('extractThinking', () => {
  it('returns plain text unchanged when there is no reasoning', () => {
    expect(extractThinking('Bara ett svar')).toEqual({ thinking: '', answer: 'Bara ett svar' });
  });

  it('splits a completed think block from the answer', () => {
    const r = extractThinking('<think>Jag funderar på X</think>Här är svaret');
    expect(r.thinking).toBe('Jag funderar på X');
    expect(r.answer).toBe('Här är svaret');
  });

  it('merges multiple think blocks', () => {
    const r = extractThinking('<think>steg 1</think>mellan<think>steg 2</think>slut');
    expect(r.thinking).toBe('steg 1\nsteg 2');
    expect(r.answer).toBe('mellanslut');
  });

  it('treats an unclosed think tag (mid-stream) as in-progress reasoning', () => {
    const r = extractThinking('<think>resonerar fortfarande');
    expect(r.thinking).toBe('resonerar fortfarande');
    expect(r.answer).toBe('');
  });

  it('handles a closed block followed by an open one while streaming', () => {
    const r = extractThinking('<think>klar tanke</think>svar börjar<think>ny tanke pågår');
    expect(r.thinking).toBe('klar tanke\nny tanke pågår');
    expect(r.answer).toBe('svar börjar');
  });

  it('is case-insensitive on the tag', () => {
    expect(extractThinking('<THINK>x</THINK>y').answer).toBe('y');
  });
});

describe('hasThinking', () => {
  it('detects a think tag', () => {
    expect(hasThinking('<think>x')).toBe(true);
    expect(hasThinking('inget')).toBe(false);
    expect(hasThinking(undefined as unknown as string)).toBe(false);
  });
});
