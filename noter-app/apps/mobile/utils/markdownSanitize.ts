/**
 * Tiny markdown tokenizer used for safe rendering on mobile.
 *
 * Why not a full library: every general-purpose markdown lib for RN
 * pulls in a parser plus HTML-rendering helpers we don't need (we have
 * a Tiptap-backed rich editor for editing). What we DO need is a
 * "preview note content safely" path that:
 *   1. Recognises a small set of block + inline elements.
 *   2. Strips dangerous primitives (script, iframe, javascript: URLs,
 *      data: URLs for non-image content).
 *   3. Emits a token stream the renderer can map to <Text> / <View>
 *      without ever evaluating arbitrary HTML.
 *
 * Recognised block tokens:
 *   - paragraph
 *   - heading-1..6
 *   - blockquote
 *   - list-item (unordered/ordered)
 *   - code-block
 *   - thematic-break
 *
 * Recognised inline tokens (within a block):
 *   - text
 *   - bold (**…**)
 *   - italic (*…* / _…_)
 *   - code (`…`)
 *   - link (label, href)
 *   - inline-image (alt, src)
 */

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: InlineToken[] }
  | { kind: 'italic'; children: InlineToken[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: InlineToken[] }
  | { kind: 'image'; src: string; alt: string };

export type BlockToken =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: InlineToken[] }
  | { kind: 'blockquote'; children: BlockToken[] }
  | { kind: 'list'; ordered: boolean; items: BlockToken[][] }
  | { kind: 'code-block'; language?: string; value: string }
  | { kind: 'thematic-break' };

const MAX_INPUT_LEN = 200_000;

const isSafeUrl = (raw: string, allowImageDataUrl: boolean): boolean => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;
  // Allow relative paths (intra-app navigation).
  if (raw.startsWith('/') && !raw.startsWith('//')) return true;
  if (raw.startsWith('#')) return true;
  if (allowImageDataUrl && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_RE = /^```(\w*)\s*$/;
const HR_RE = /^[-*_]{3,}\s*$/;
const QUOTE_RE = /^>\s?(.*)$/;
const ULIST_RE = /^[*\-+]\s+(.+)$/;
const OLIST_RE = /^\d+\.\s+(.+)$/;

/**
 * Tokenise a string of inline markdown into safe inline-tokens.
 * The tokenizer walks left-to-right with explicit state so deeply-nested
 * unbalanced markers don't blow the stack.
 */
const tokeniseInline = (raw: string): InlineToken[] => {
  if (raw.length === 0) return [];
  const out: InlineToken[] = [];
  const pushText = (s: string): void => {
    if (s.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.value += s;
    else out.push({ kind: 'text', value: s });
  };

  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);

    // Image: ![alt](src)
    const img = /^!\[([^\]\n]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (img) {
      const alt = img[1];
      const src = img[2];
      if (isSafeUrl(src, true)) {
        out.push({ kind: 'image', src, alt });
      } else {
        pushText(`[${alt}]`); // refuse to render image; surface alt
      }
      i += img[0].length;
      continue;
    }

    // Link: [text](href)
    const link = /^\[([^\]\n]+?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      const label = link[1];
      const href = link[2];
      if (isSafeUrl(href, false)) {
        out.push({ kind: 'link', href, children: tokeniseInline(label) });
      } else {
        pushText(label);
      }
      i += link[0].length;
      continue;
    }

    // Inline code
    if (rest.startsWith('`')) {
      const m = /^`([^`\n]+)`/.exec(rest);
      if (m) {
        out.push({ kind: 'code', value: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Bold: **…**
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end > 2) {
        out.push({ kind: 'bold', children: tokeniseInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Italic: *…* or _…_
    if ((rest[0] === '*' || rest[0] === '_') && rest[1] !== rest[0]) {
      const closer = rest.indexOf(rest[0], 1);
      if (closer > 1) {
        out.push({ kind: 'italic', children: tokeniseInline(rest.slice(1, closer)) });
        i += closer + 1;
        continue;
      }
    }

    // Plain text: consume one char and continue.
    pushText(rest[0]);
    i++;
  }
  return out;
};

/**
 * Block-level tokenizer. Splits on newlines, recognises block prefixes
 * (headings, lists, blockquotes, code fences), and recursively tokenises
 * inline content.
 */
export const tokeniseMarkdown = (raw: string): BlockToken[] => {
  if (typeof raw !== 'string') return [];
  if (raw.length === 0) return [];
  const input = raw.length > MAX_INPUT_LEN ? raw.slice(0, MAX_INPUT_LEN) : raw;
  const lines = input.split(/\r?\n/);
  const blocks: BlockToken[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }
    if (HR_RE.test(line)) { blocks.push({ kind: 'thematic-break' }); i++; continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, inline: tokeniseInline(heading[2]) });
      i++;
      continue;
    }

    const fence = CODE_FENCE_RE.exec(line);
    if (fence) {
      const language = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ kind: 'code-block', language, value: buf.join('\n') });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(QUOTE_RE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ kind: 'blockquote', children: tokeniseMarkdown(buf.join('\n')) });
      continue;
    }

    if (ULIST_RE.test(line) || OLIST_RE.test(line)) {
      const ordered = OLIST_RE.test(line);
      const items: BlockToken[][] = [];
      const RE = ordered ? OLIST_RE : ULIST_RE;
      while (i < lines.length && RE.test(lines[i])) {
        const text = RE.exec(lines[i])![1];
        items.push([{ kind: 'paragraph', inline: tokeniseInline(text) }]);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph: collect adjacent non-block lines.
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !HEADING_RE.test(lines[i]) && !HR_RE.test(lines[i])
      && !CODE_FENCE_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])
      && !ULIST_RE.test(lines[i]) && !OLIST_RE.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'paragraph', inline: tokeniseInline(buf.join('\n')) });
  }
  return blocks;
};

// Test helpers
export const _isSafeUrl = isSafeUrl;
export const _tokeniseInline = tokeniseInline;
