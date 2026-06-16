import * as DocumentPicker from 'expo-document-picker';
// Legacy API: the v19 main export dropped readAsStringAsync/EncodingType (same
// import noteExport.ts uses).
import * as FileSystem from 'expo-file-system/legacy';
import {
  AiAttachment,
  isTextLikeAttachment,
  isImageAttachment,
  classifyFile,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS,
} from '@repo/shared';
import {
  isPdfHostReady, extractPdfTextMobile, extractDocxMobile, extractXlsxMobile, extractImageOcrMobile,
} from '@/services/ai/pdfText';

/** Max image bytes to base64-inline for a vision model (~3 MB keeps payloads sane). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Mobile glue for AI chat file attachments. The picker + file read live here; all
 * formatting/interpretation lives in @repo/shared (aiAttachments) so it's identical
 * across clients and unit-tested without a device.
 *
 * Text-like files are read as UTF-8 and inlined into the prompt context. Binary
 * files (PDF/image/office) are attached with metadata only — the shared formatter
 * emits an honest placeholder so the model knows a file is present; a future
 * vision/parse path can fill in the content without touching call sites.
 */

/** Read a text-like file's content (capped) or return undefined for binary. */
const readTextIfPossible = async (uri: string, name: string, mimeType: string): Promise<string | undefined> => {
  if (!isTextLikeAttachment({ name, mimeType })) return undefined;
  try {
    const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    // Hard cap at read time too, so we never hold a huge string in memory.
    return content.length > MAX_ATTACHMENT_CHARS + 1000
      ? content.slice(0, MAX_ATTACHMENT_CHARS + 1000)
      : content;
  } catch {
    return undefined;
  }
};

/**
 * Extract real text from a rich file (PDF/Word/Excel/image) via the WebView pdf.js/mammoth/
 * SheetJS/Tesseract host, so the model reads its content. Returns undefined if the host isn't
 * mounted or nothing extractable. Reads base64 once and routes by classified kind.
 */
const readRichText = async (uri: string, name: string, mimeType: string): Promise<string | undefined> => {
  const kind = classifyFile(name, mimeType);
  if (kind !== 'pdf' && kind !== 'docx' && kind !== 'xlsx' && kind !== 'image') return undefined;
  if (!isPdfHostReady()) return undefined;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    if (!b64) return undefined;
    if (kind === 'pdf') return (await extractPdfTextMobile(b64)) || undefined;
    if (kind === 'docx') return (await extractDocxMobile(b64)) || undefined;
    if (kind === 'xlsx') return (await extractXlsxMobile(b64)) || undefined;
    const t = (await extractImageOcrMobile(b64)) || '';
    return t.trim() ? '[OCR-text ur bild]\n' + t : undefined;
  } catch {
    return undefined;
  }
};

/** Read an image as a base64 data URL for a vision model, or undefined if too big. */
const readImageDataUrl = async (
  uri: string,
  name: string,
  mimeType: string,
  size?: number,
): Promise<string | undefined> => {
  if (!isImageAttachment({ name, mimeType })) return undefined;
  if (typeof size === 'number' && size > MAX_IMAGE_BYTES) return undefined;
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const mime = mimeType || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch {
    return undefined;
  }
};

/**
 * Open the OS document picker and return normalized attachments (≤ MAX_ATTACHMENTS).
 * Returns [] when the user cancels. Never throws — a failed read degrades to a
 * metadata-only (binary) attachment so the user still sees something happened.
 */
export const pickAttachments = async (): Promise<AiAttachment[]> => {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled || !result.assets?.length) return [];

  const assets = result.assets.slice(0, MAX_ATTACHMENTS);
  const out: AiAttachment[] = [];
  for (const asset of assets) {
    const name = asset.name || 'fil';
    const mimeType = asset.mimeType || '';
    const size = asset.size ?? undefined;
    let text = await readTextIfPossible(asset.uri, name, mimeType);
    if (!text) text = await readRichText(asset.uri, name, mimeType); // pdf/docx/xlsx/image-OCR
    const dataUrl = await readImageDataUrl(asset.uri, name, mimeType, size);
    out.push({ name, mimeType, size, text, dataUrl });
  }
  return out;
};
