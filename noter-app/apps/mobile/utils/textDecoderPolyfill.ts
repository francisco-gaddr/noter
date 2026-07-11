/**
 * Minimal, streaming-safe UTF-8 TextDecoder polyfill.
 *
 * Why: the API chat streams SSE bytes and decodes them with `new TextDecoder().decode(chunk, {stream:
 * true})`. If a build's JS engine lacks a global `TextDecoder`, that line throws and streaming silently
 * falls back to a non-streamed request (tokens never appear live). Modern Hermes ships TextDecoder, so
 * this installs ONLY when it is genuinely absent — a safety net, not a replacement.
 *
 * The tricky part is `{ stream: true }`: a multibyte character can be split across two chunks, so the
 * decoder must HOLD an incomplete trailing sequence and prepend it to the next chunk. This class does
 * exactly that and is unit-tested (feed a code point one byte at a time → correct final string).
 */

const bytesFromInput = (input?: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  const view = input as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
};

/** How many bytes the UTF-8 sequence starting with lead byte `b` occupies (1..4). */
const seqLen = (b: number): number => (b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4);

/** Decode a complete byte array to a string (assumes no trailing incomplete sequence). */
const decodeComplete = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    const n = seqLen(b0);
    let cp = 0;
    if (n === 1) cp = b0;
    else if (n === 2) cp = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
    else if (n === 3) cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
    else cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
};

export class MiniTextDecoder {
  readonly encoding = 'utf-8';
  private pending: number[] = [];

  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string {
    const incoming = bytesFromInput(input);
    const all = this.pending.length ? Uint8Array.from(this.pending.concat(Array.from(incoming))) : incoming;

    let cut = all.length;
    if (options?.stream && all.length > 0) {
      // Walk back over trailing continuation bytes to the lead byte; if the sequence it starts is
      // incomplete, hold from there for the next chunk.
      for (let i = all.length - 1; i >= 0 && i >= all.length - 3; i -= 1) {
        if ((all[i] & 0xc0) === 0x80) continue; // continuation byte — keep walking back
        const need = seqLen(all[i]);
        if (i + need > all.length) cut = i; // incomplete lead sequence at the tail
        break;
      }
    }

    this.pending = options?.stream ? Array.from(all.slice(cut)) : [];
    return decodeComplete(all.slice(0, cut));
  }
}

/** Install the polyfill on the global scope IFF no TextDecoder is present. Returns true if installed. */
export const installTextDecoderPolyfill = (): boolean => {
  const g = global as unknown as { TextDecoder?: unknown };
  if (typeof g.TextDecoder !== 'undefined') return false;
  g.TextDecoder = MiniTextDecoder as unknown as typeof TextDecoder;
  return true;
};
