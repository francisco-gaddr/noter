import { planIngest, parseNoteSource, ingestProvenanceHeader, type IngestEntry, type SyncedNoteRef } from './fileIngest';

const entry = (path: string, isCollection: boolean, etag: string, mime = ''): IngestEntry => ({
  path, name: path.split('/').pop() || path, isCollection, etag, mimeType: mime, lastModified: '',
});

describe('fileIngest.planIngest', () => {
  const conn = 'conn1';
  const synced = (id: string, remotePath: string, etag: string, type: 'note' | 'project' = 'note'): SyncedNoteRef => ({
    _id: id, type, source: { origin: 'nextcloud', connectionId: conn, remotePath, remoteEtag: etag },
  });

  it('creates folders before files, shallow→deep, with parent paths', () => {
    const entries = [
      entry('Research/Under/note.md', false, 'e1'),
      entry('Research', true, 'f1'),
      entry('Research/Under', true, 'f2'),
      entry('Research/top.md', false, 'e2'),
    ];
    const plan = planIngest(entries, [], conn, '2026-06-16');
    const kinds = plan.creates.map((c) => c.type);
    // all folders precede all files
    expect(kinds.slice(0, 2).every((k) => k === 'project')).toBe(true);
    const byPath = Object.fromEntries(plan.creates.map((c) => [c.source.remotePath, c]));
    expect(byPath['Research'].parentRemotePath).toBe(null);
    expect(byPath['Research/Under'].parentRemotePath).toBe('Research');
    expect(byPath['Research/Under/note.md'].parentRemotePath).toBe('Research/Under');
    expect(byPath['Research/top.md'].needsContent).toBe(true);
    expect(byPath['Research'].needsContent).toBe(false);
  });

  it('updates only when the remote etag changed; leaves unchanged alone', () => {
    const existing = [synced('n1', 'Research/a.md', 'v1'), synced('n2', 'Research/b.md', 'v9')];
    const entries = [
      entry('Research/a.md', false, 'v2'), // changed
      entry('Research/b.md', false, 'v9'), // same
    ];
    const plan = planIngest(entries, existing, conn, 't');
    expect(plan.updates.map((u) => u.noteId)).toEqual(['n1']);
    expect(plan.updates[0].source.remoteEtag).toBe('v2');
    expect(plan.unchanged).toContain('n2');
    expect(plan.creates).toEqual([]);
  });

  it('deletes notes whose remote path vanished, scoped to this connection', () => {
    const existing = [
      synced('n1', 'Research/a.md', 'v1'),
      synced('n2', 'Research/gone.md', 'v1'),
      { _id: 'other', source: { origin: 'nextcloud', connectionId: 'conn2', remotePath: 'X', remoteEtag: 'v' } } as SyncedNoteRef,
      { _id: 'hand', source: null } as SyncedNoteRef, // hand-written note, never touched
    ];
    const entries = [entry('Research/a.md', false, 'v1')];
    const plan = planIngest(entries, existing, conn, 't');
    expect(plan.deletes).toEqual(['n2']);
    expect(plan.deletes).not.toContain('other');
    expect(plan.deletes).not.toContain('hand');
  });
});

describe('fileIngest helpers', () => {
  it('parses a source that may be a JSON string or object, rejecting junk', () => {
    const obj = { origin: 'nextcloud', connectionId: 'c', remotePath: 'p', remoteEtag: 'e' };
    expect(parseNoteSource(JSON.stringify(obj))?.remotePath).toBe('p');
    expect(parseNoteSource(obj)?.connectionId).toBe('c');
    expect(parseNoteSource('not json')).toBe(null);
    expect(parseNoteSource({ connectionId: 'c' })).toBe(null); // missing remotePath
    expect(parseNoteSource(null)).toBe(null);
  });

  it('builds a provenance header', () => {
    const h = ingestProvenanceHeader({ origin: 'nextcloud', connectionId: 'c', remotePath: 'Research/x.pdf', remoteEtag: 'e', mimeType: 'application/pdf' });
    expect(h).toContain('Research/x.pdf');
    expect(h).toContain('Nextcloud');
  });
});
