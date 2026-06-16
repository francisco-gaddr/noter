import {
  slugifyName,
  serializeNoteToMarkdown,
  parseMarkdownFile,
  fileEtag,
  assignVaultPaths,
  normalizeVaultPath,
  buildMarkdownVaultProjection,
  renderVaultFile,
  type VaultNote,
} from './markdownVault';

describe('markdownVault', () => {
  describe('slugifyName', () => {
    it('keeps unicode letters, strips path/illegal chars, no leading dots', () => {
      expect(slugifyName('My Note')).toBe('My Note');
      expect(slugifyName('a/b:c*?"<>|#^[]')).toBe('a b c');
      expect(slugifyName('  ..hidden  ')).toBe('hidden');
      expect(slugifyName('Åäö é')).toBe('Åäö é');
      expect(slugifyName('')).toBe('note');
    });
  });

  describe('serialize ↔ parse round-trip', () => {
    it('is loss-free for body, title, tags, id, type', () => {
      const note: VaultNote = {
        _id: 'n1', title: 'Hello: world', content: '# Body\n\nLine two\n\n- a\n- b',
        tags: ['x', 'y z'], type: 'note', createdAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T01:00:00.000Z',
      };
      const md = serializeNoteToMarkdown(note);
      expect(md.startsWith('---\n')).toBe(true);
      const parsed = parseMarkdownFile(md);
      expect(parsed.id).toBe('n1');
      expect(parsed.title).toBe('Hello: world');
      expect(parsed.type).toBe('note');
      expect(parsed.tags).toEqual(['x', 'y z']);
      expect(parsed.body.trim()).toBe(note.content.trim());
      expect(parsed.createdAt).toBe('2026-06-16T00:00:00.000Z');
    });

    it('parses a file with no frontmatter (external new note)', () => {
      const parsed = parseMarkdownFile('Just some text\nmore');
      expect(parsed.id).toBeNull();
      expect(parsed.body).toContain('Just some text');
    });

    it('parses block-style tags list', () => {
      const md = '---\nid: n2\ntitle: T\ntags:\n  - alpha\n  - beta\n---\nbody';
      const parsed = parseMarkdownFile(md);
      expect(parsed.tags).toEqual(['alpha', 'beta']);
      expect(parsed.body.trim()).toBe('body');
    });
  });

  describe('fileEtag', () => {
    it('is stable for identical content and changes when body changes', () => {
      const a = fileEtag({ noteId: 'n', title: 't', body: 'b', tags: ['x'], type: 'note' });
      const b = fileEtag({ noteId: 'n', title: 't', body: 'b', tags: ['x'], type: 'note' });
      const c = fileEtag({ noteId: 'n', title: 't', body: 'B', tags: ['x'], type: 'note' });
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe('assignVaultPaths', () => {
    it('dedupes colliding names within a directory deterministically', () => {
      const paths = assignVaultPaths([
        { noteId: '1', title: 'Note', segments: [] },
        { noteId: '2', title: 'Note', segments: [] },
        { noteId: '3', title: 'Note', segments: ['Work'] },
      ]);
      const all = [...paths.values()].sort();
      expect(all).toEqual(['Note 2.md', 'Note.md', 'Work/Note.md'].sort());
    });
  });

  describe('normalizeVaultPath', () => {
    it('rejects traversal and accepts clean paths', () => {
      expect(normalizeVaultPath('/Work/Note.md')).toBe('Work/Note.md');
      expect(normalizeVaultPath('../secret')).toBeNull();
      expect(normalizeVaultPath('a/../b')).toBeNull();
      expect(normalizeVaultPath('')).toBeNull();
      expect(normalizeVaultPath('a/\0/b')).toBeNull();
    });
  });

  describe('buildMarkdownVaultProjection', () => {
    const notes: VaultNote[] = [
      { _id: 'proj', title: 'Work', type: 'project', parentId: null },
      { _id: 'a', title: 'Alpha', type: 'note', parentId: 'proj', content: 'A body' },
      { _id: 'b', title: 'Beta', type: 'note', parentId: 'proj', content: 'B body', locked: true },
      { _id: 'c', title: 'Loose', type: 'note', parentId: null, content: 'C body' },
    ];

    it('includes notes under a shared folder, places them in the folder dir', () => {
      const proj = buildMarkdownVaultProjection(notes, { folderIds: ['proj'], isLocked: (n) => !!n.locked });
      const paths = proj.map((p) => p.path).sort();
      expect(paths).toContain('Work/Alpha.md');
      // locked note 'b' must NEVER be projected
      expect(paths.some((p) => p.includes('Beta'))).toBe(false);
      // loose note not in the shared folder is excluded
      expect(paths.some((p) => p.includes('Loose'))).toBe(false);
    });

    it('includes explicitly-shared individual notes', () => {
      const proj = buildMarkdownVaultProjection(notes, { noteIds: ['c'] });
      expect(proj.map((p) => p.path)).toEqual(['Loose.md']);
      expect(proj[0].noteId).toBe('c');
    });

    it('never projects a locked note even if explicitly listed', () => {
      const proj = buildMarkdownVaultProjection(notes, { noteIds: ['b'], isLocked: (n) => !!n.locked });
      expect(proj).toHaveLength(0);
    });

    it('renderVaultFile round-trips back to the note', () => {
      const proj = buildMarkdownVaultProjection(notes, { noteIds: ['a'] });
      const md = renderVaultFile(proj[0]);
      const parsed = parseMarkdownFile(md);
      expect(parsed.id).toBe('a');
      expect(parsed.body.trim()).toBe('A body');
    });
  });
});
