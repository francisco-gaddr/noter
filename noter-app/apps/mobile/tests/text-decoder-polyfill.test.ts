import { MiniTextDecoder, installTextDecoderPolyfill } from '../utils/textDecoderPolyfill';

const enc = (s: string): Uint8Array => {
  // Node's Buffer gives us the reference UTF-8 bytes to feed the polyfill.
  return Uint8Array.from(Buffer.from(s, 'utf-8'));
};

describe('MiniTextDecoder (streaming-safe UTF-8)', () => {
  it('decodes plain ASCII in one shot', () => {
    expect(new MiniTextDecoder().decode(enc('hello'))).toBe('hello');
  });

  it('decodes multibyte (emoji + CJK) in one shot', () => {
    const s = 'héllo 世界 🚀';
    expect(new MiniTextDecoder().decode(enc(s))).toBe(s);
  });

  it('holds an incomplete multibyte sequence split across streamed chunks (the SSE case)', () => {
    const d = new MiniTextDecoder();
    const bytes = enc('🚀'); // 4-byte code point
    let out = '';
    // Feed the 4 bytes ONE at a time with { stream: true } — the rocket must only appear once complete.
    for (let i = 0; i < bytes.length; i += 1) {
      out += d.decode(Uint8Array.of(bytes[i]), { stream: true });
    }
    out += d.decode(); // final flush
    expect(out).toBe('🚀');
  });

  it('a CJK char split across two chunks decodes correctly', () => {
    const d = new MiniTextDecoder();
    const bytes = enc('世'); // 3 bytes
    const a = d.decode(bytes.slice(0, 2), { stream: true }); // incomplete
    const b = d.decode(bytes.slice(2), { stream: true }); // completes it
    expect(a + b).toBe('世');
  });

  it('installTextDecoderPolyfill is a no-op when a TextDecoder already exists', () => {
    const g = global as any;
    const had = g.TextDecoder;
    g.TextDecoder = function () {}; // pretend one exists
    expect(installTextDecoderPolyfill()).toBe(false);
    g.TextDecoder = had;
  });

  it('installTextDecoderPolyfill installs MiniTextDecoder when absent', () => {
    const g = global as any;
    const had = g.TextDecoder;
    delete g.TextDecoder;
    expect(installTextDecoderPolyfill()).toBe(true);
    expect(new g.TextDecoder().decode(enc('ok'))).toBe('ok');
    g.TextDecoder = had;
  });
});
