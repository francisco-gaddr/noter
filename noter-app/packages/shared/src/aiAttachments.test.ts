import {
  isTextLikeAttachment,
  attachmentKindLabel,
  extractAttachmentText,
  buildAttachmentContextBlock,
  summarizeAttachmentsForUi,
  MAX_ATTACHMENT_CHARS,
  MAX_ATTACHMENTS,
  type AiAttachment,
} from './aiAttachments';

describe('aiAttachments', () => {
  it('detects text-like files by mime and by extension', () => {
    expect(isTextLikeAttachment({ name: 'a.md', mimeType: 'text/markdown' })).toBe(true);
    expect(isTextLikeAttachment({ name: 'a.json', mimeType: 'application/json' })).toBe(true);
    expect(isTextLikeAttachment({ name: 'script.ts', mimeType: '' })).toBe(true); // by ext
    expect(isTextLikeAttachment({ name: 'photo.png', mimeType: 'image/png' })).toBe(false);
    expect(isTextLikeAttachment({ name: 'doc.pdf', mimeType: 'application/pdf' })).toBe(false);
  });

  it('labels binary kinds for placeholders/UI', () => {
    expect(attachmentKindLabel({ name: 'x.png', mimeType: 'image/png' })).toBe('bild');
    expect(attachmentKindLabel({ name: 'x.pdf', mimeType: 'application/pdf' })).toBe('PDF');
    expect(attachmentKindLabel({ name: 'x.docx', mimeType: '' })).toBe('Word-dokument');
    expect(attachmentKindLabel({ name: 'notes.md', mimeType: 'text/markdown' })).toBe('textfil');
  });

  it('inlines text verbatim under the cap', () => {
    const att: AiAttachment = { name: 'n.md', mimeType: 'text/markdown', text: '# Hello\nworld' };
    expect(extractAttachmentText(att)).toBe('# Hello\nworld');
  });

  it('truncates text over the cap and annotates the omission', () => {
    const big = 'x'.repeat(MAX_ATTACHMENT_CHARS + 500);
    const out = extractAttachmentText({ name: 'big.txt', mimeType: 'text/plain', text: big });
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('avkortad: 500 tecken till');
  });

  it('emits an honest placeholder for binary files (no text)', () => {
    const out = extractAttachmentText({ name: 'scan.pdf', mimeType: 'application/pdf' });
    expect(out).toContain('PDF bifogad');
    expect(out).toContain('scan.pdf');
    expect(out).toContain('kunde inte läsas som text');
  });

  it('builds a parseable context block, or empty string when no attachments', () => {
    expect(buildAttachmentContextBlock([])).toBe('');
    const block = buildAttachmentContextBlock([
      { name: 'a.md', mimeType: 'text/markdown', text: 'alpha' },
      { name: 'b.txt', mimeType: 'text/plain', text: 'beta' },
    ]);
    expect(block.startsWith('<bifogade_filer>')).toBe(true);
    expect(block.trimEnd().endsWith('</bifogade_filer>')).toBe(true);
    expect(block).toContain('Fil 1: a.md');
    expect(block).toContain('alpha');
    expect(block).toContain('Fil 2: b.txt');
    expect(block).toContain('beta');
  });

  it('caps the number of attachments and notes the overflow', () => {
    const many: AiAttachment[] = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => ({
      name: `f${i}.txt`, mimeType: 'text/plain', text: `c${i}`,
    }));
    const block = buildAttachmentContextBlock(many);
    expect(block).toContain('3 ytterligare bifogade filer utelämnades');
    expect(block).toContain(`Fil ${MAX_ATTACHMENTS}:`);
    expect(block).not.toContain(`Fil ${MAX_ATTACHMENTS + 1}:`);
  });

  it('summarizes attachments into UI chips with size', () => {
    const chips = summarizeAttachmentsForUi([
      { name: 'a.md', mimeType: 'text/markdown', size: 2048 },
      { name: 'b.txt', mimeType: 'text/plain' },
    ]);
    expect(chips[0]).toBe('a.md · 2 kB');
    expect(chips[1]).toBe('b.txt');
  });
});
