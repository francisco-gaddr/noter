import * as DocumentPicker from 'expo-document-picker';
// Legacy API: the v19 main export dropped readAsStringAsync/EncodingType (same
// import noteExport.ts uses).
import * as FileSystem from 'expo-file-system/legacy';
import {
  AiAttachment,
  isTextLikeAttachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS,
} from '@repo/shared';

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
    const text = await readTextIfPossible(asset.uri, name, mimeType);
    out.push({ name, mimeType, size: asset.size ?? undefined, text });
  }
  return out;
};
