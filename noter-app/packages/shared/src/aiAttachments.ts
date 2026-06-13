/**
 * AI chat file attachments — shared, platform-agnostic core.
 *
 * The picker (expo-document-picker / expo-image-picker on mobile, <input type=file>
 * on web) is a thin per-platform layer; THIS file is the part that matters: turning
 * a picked file into the text context the model actually sees, with size caps and a
 * consistent, parseable format. Reused by mobile, web and Electron so "interpret an
 * attached file" behaves identically everywhere.
 *
 * Text-like files (md/txt/json/csv/code) are inlined verbatim (truncated). Binary
 * files (pdf/images/office) can't be read as text here — they get a clear placeholder
 * so the model knows a file was attached and what kind, and so a future vision/parse
 * path can replace the placeholder without changing call sites.
 */

export interface AiAttachment {
  /** File name as shown to the user, e.g. "notes.md". */
  name: string;
  /** MIME type, e.g. "text/markdown". May be '' if unknown. */
  mimeType: string;
  /** Byte size if known (for the UI chip + caps). */
  size?: number;
  /** Decoded UTF-8 text for text-like files; undefined for binary. */
  text?: string;
  /** base64 data URL (`data:<mime>;base64,…`) for images — fed to vision models. */
  dataUrl?: string;
}

/** Hard cap on injected text per attachment (chars) so one file can't blow the
 *  context window. ~24k chars ≈ 6k tokens. */
export const MAX_ATTACHMENT_CHARS = 24_000;
/** Cap on the number of attachments folded into one message. */
export const MAX_ATTACHMENTS = 6;

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/markdown',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/csv',
]);
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml',
  'xml', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cs', 'php', 'sh', 'bash', 'sql', 'toml', 'ini', 'env', 'log',
  'css', 'scss',
]);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** True when the file can be meaningfully inlined as UTF-8 text. */
export const isTextLikeAttachment = (att: Pick<AiAttachment, 'name' | 'mimeType'>): boolean => {
  const mime = (att.mimeType || '').toLowerCase();
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  if (TEXT_MIME_EXACT.has(mime)) return true;
  return TEXT_EXTENSIONS.has(extensionOf(att.name || ''));
};

/** Human label for a binary attachment kind (used in placeholders/UI). */
export const attachmentKindLabel = (att: Pick<AiAttachment, 'name' | 'mimeType'>): string => {
  const mime = (att.mimeType || '').toLowerCase();
  const ext = extensionOf(att.name || '');
  if (mime.startsWith('image/')) return 'bild';
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (mime.includes('word') || ext === 'doc' || ext === 'docx') return 'Word-dokument';
  if (mime.includes('sheet') || ext === 'xls' || ext === 'xlsx') return 'kalkylark';
  if (isTextLikeAttachment(att)) return 'textfil';
  return 'fil';
};

/** Extract the text a model should see for one attachment (truncated + annotated). */
export const extractAttachmentText = (att: AiAttachment): string => {
  if (isTextLikeAttachment(att) && typeof att.text === 'string') {
    const trimmed = att.text;
    if (trimmed.length <= MAX_ATTACHMENT_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_ATTACHMENT_CHARS)}\n…[avkortad: ${trimmed.length - MAX_ATTACHMENT_CHARS} tecken till]`;
  }
  // Binary / unreadable here — give the model a clear, honest placeholder.
  const kind = attachmentKindLabel(att);
  return `[${kind} bifogad: "${att.name}" – innehållet kunde inte läsas som text på enheten]`;
};

/**
 * Build the context block prepended to the user's message. Returns '' when there
 * are no attachments so call sites can concatenate unconditionally.
 */
export const buildAttachmentContextBlock = (attachments: AiAttachment[]): string => {
  if (!attachments || attachments.length === 0) return '';
  const used = attachments.slice(0, MAX_ATTACHMENTS);
  const parts = used.map((att, i) => {
    const header = `Fil ${i + 1}: ${att.name}${att.mimeType ? ` (${att.mimeType})` : ''}`;
    return `--- ${header} ---\n${extractAttachmentText(att)}`;
  });
  const overflow = attachments.length > MAX_ATTACHMENTS
    ? `\n[${attachments.length - MAX_ATTACHMENTS} ytterligare bifogade filer utelämnades]`
    : '';
  return `<bifogade_filer>\n${parts.join('\n\n')}${overflow}\n</bifogade_filer>\n\n`;
};

/** True when the attachment is an image we can hand to a vision model. */
export const isImageAttachment = (att: Pick<AiAttachment, 'name' | 'mimeType'>): boolean => {
  const mime = (att.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(extensionOf(att.name || ''));
};

/** Cap on images forwarded to a vision model per message. */
export const MAX_IMAGE_ATTACHMENTS = 4;

/** Collect the data URLs of image attachments that actually have one (≤ cap). */
export const imageDataUrls = (attachments: AiAttachment[]): string[] =>
  (attachments || [])
    .filter((a) => isImageAttachment(a) && typeof a.dataUrl === 'string' && a.dataUrl.length > 0)
    .map((a) => a.dataUrl as string)
    .slice(0, MAX_IMAGE_ATTACHMENTS);

/** Split a `data:<mime>;base64,<data>` URL into its parts (for Gemini inlineData). */
export const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } | null => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
};

/** Short chip labels for the composer UI. */
export const summarizeAttachmentsForUi = (attachments: AiAttachment[]): string[] =>
  (attachments || []).map((att) => {
    const kb = typeof att.size === 'number' && att.size > 0 ? ` · ${Math.max(1, Math.round(att.size / 1024))} kB` : '';
    return `${att.name}${kb}`;
  });
