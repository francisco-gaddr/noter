// expo-file-system v19 moved the file APIs we use into the `/legacy` entrypoint.
// Importing from there is the supported path for `cacheDirectory` +
// `writeAsStringAsync` until expo ships the new file API.
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * Export utilities for notes.
 *
 * Two outputs:
 *   - exportNoteToMarkdown — writes a .md file to expo's cache directory
 *     and opens the share sheet.
 *   - exportNoteToPdf — uses expo-print to render HTML → PDF (with a
 *     simple inline stylesheet) and opens the share sheet.
 *
 * Both refuse to operate on locked notes — the caller passes `locked:
 * true` and we throw a typed error.
 *
 * Pure HTML composition is exported separately for tests.
 */

const MAX_TITLE_LEN = 120;
const MAX_CONTENT_LEN = 200_000;

export class LockedNoteExportError extends Error {
  constructor() {
    super('Cannot export a locked note. Unlock it first.');
    this.name = 'LockedNoteExportError';
  }
}

export interface ExportableNote {
  id: string;
  title: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  locked?: boolean;
}

const safeFilename = (raw: string): string => {
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, MAX_TITLE_LEN);
  return cleaned.length > 0 ? cleaned : 'note';
};

const escapeHtml = (raw: string): string => raw.replace(/[<>&"']/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
}[c] as string));

export const buildMarkdownExport = (note: ExportableNote): string => {
  if (note.locked) throw new LockedNoteExportError();
  const title = note.title?.trim() || 'Untitled note';
  const body = (note.content || '').slice(0, MAX_CONTENT_LEN);
  const updated = note.updatedAt ? `\n\n_Updated: ${note.updatedAt}_` : '';
  return `# ${title}\n\n${body}${updated}\n`;
};

export const buildHtmlExport = (note: ExportableNote): string => {
  if (note.locked) throw new LockedNoteExportError();
  const title = escapeHtml(note.title?.trim() || 'Untitled note');
  // Caller is expected to pass already-rendered HTML for rich content;
  // when the input is plain text, we preserve line breaks defensively.
  const content = (note.content || '').slice(0, MAX_CONTENT_LEN);
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(content);
  const body = looksLikeHtml
    ? content
    : `<pre style="white-space:pre-wrap;font-family:system-ui,-apple-system,sans-serif;">${escapeHtml(content)}</pre>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 24px; color: #1c1b1f; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    pre { font-size: 13px; line-height: 1.5; }
    code { background: #f6f5fa; padding: 2px 5px; border-radius: 3px; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
};

const isSharingAvailable = async (): Promise<boolean> => {
  try { return await Sharing.isAvailableAsync(); } catch { return false; }
};

export const exportNoteToMarkdown = async (note: ExportableNote): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> => {
  try {
    const md = buildMarkdownExport(note);
    const filename = `${safeFilename(note.title || 'note')}.md`;
    const uri = `${FileSystem.cacheDirectory ?? ''}${filename}`;
    await FileSystem.writeAsStringAsync(uri, md, { encoding: FileSystem.EncodingType.UTF8 });
    if (await isSharingAvailable()) {
      await Sharing.shareAsync(uri, { mimeType: 'text/markdown', dialogTitle: 'Export note' });
    }
    return { ok: true, uri };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message ?? 'export-failed' };
  }
};

export const exportNoteToPdf = async (note: ExportableNote): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> => {
  try {
    const html = buildHtmlExport(note);
    const { uri } = await Print.printToFileAsync({ html });
    if (await isSharingAvailable()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export note as PDF' });
    }
    return { ok: true, uri };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message ?? 'export-failed' };
  }
};

// Test exports
export const _safeFilename = safeFilename;
export const _escapeHtml = escapeHtml;
