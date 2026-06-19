import { planIngest, parseNoteSource, ingestProvenanceHeader, normalizeEtag, remoteChangedSinceSync, type IngestEntry, type SyncedNoteRef } from './fileIngest';

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

describe('fileIngest.planIngest scoped (single-folder pull)', () => {
  const conn = 'conn1';
  const synced = (id: string, remotePath: string, etag = 'v1'): SyncedNoteRef => ({
    _id: id, type: 'note', source: { origin: 'nextcloud', connectionId: conn, remotePath, remoteEtag: etag },
  });

  it('only deletes notes WITHIN the scoped subtree (never elsewhere in the connection)', () => {
    const existing = [
      synced('inA', 'synked/a.md'),       // in scope, gone remotely → delete
      synced('inB', 'synked/keep.md'),    // in scope, still present → keep
      synced('outX', 'Other/x.md'),       // OUT of scope → must NOT be deleted by a scoped pull
      synced('folder', 'synked'),         // the scoped folder itself, still present → keep
    ];
    // A scoped pull of "synked" only enumerates that subtree.
    const entries = [entry('synked', true, 'f1'), entry('synked/keep.md', false, 'v1')];
    const plan = planIngest(entries, existing, conn, 't', 'synked');
    expect(plan.deletes).toEqual(['inA']);
    expect(plan.deletes).not.toContain('outX'); // critical: scoped pull must not touch other folders
  });

  it('an UNscoped pull still deletes anything gone across the whole connection', () => {
    const existing = [synced('inA', 'synked/a.md'), synced('outX', 'Other/x.md')];
    const plan = planIngest([], existing, conn, 't'); // no onlyUnderPath
    expect(plan.deletes.sort()).toEqual(['inA', 'outX']);
  });
});

describe('parseNoteSource idempotency (re-materialize must not wipe a synced note)', () => {
  it('handles an ALREADY-PARSED source object, not just a ciphertext string', () => {
    const obj = { origin: 'nextcloud', connectionId: 'c', remotePath: 'synked/a.md', remoteEtag: 'e' };
    // First materialize: source arrives as a (JSON) string.
    expect(parseNoteSource(JSON.stringify(obj))?.origin).toBe('nextcloud');
    // Re-materialize: the note is already materialized, so source is an OBJECT. It MUST survive —
    // the bug was the client calling parseNoteSource(safeDecrypt(object)) which returned null and
    // dropped the note's sync on every save/socket event.
    expect(parseNoteSource(obj as any)?.origin).toBe('nextcloud');
    expect(parseNoteSource(obj as any)?.remotePath).toBe('synked/a.md');
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

describe('normalizeEtag', () => {
  it('strips a weak-validator prefix and surrounding quotes', () => {
    expect(normalizeEtag('"abc123"')).toBe('abc123');
    expect(normalizeEtag('W/"abc123"')).toBe('abc123');
    expect(normalizeEtag(' "abc" ')).toBe('abc');
    expect(normalizeEtag(undefined)).toBe('');
  });
});

describe('remoteChangedSinceSync (optimistic concurrency for the two-way push)', () => {
  it('true when the remote etag differs from the last-synced etag (would clobber a remote edit)', () => {
    expect(remoteChangedSinceSync('"v2"', 'v1')).toBe(true);
  });
  it('false when they match (quoting/weak-prefix differences are ignored)', () => {
    expect(remoteChangedSinceSync('"v1"', 'v1')).toBe(false);
    expect(remoteChangedSinceSync('W/"v1"', '"v1"')).toBe(false);
  });
  it('false when either side is unknown — never blocks a first upload or a folder', () => {
    expect(remoteChangedSinceSync('', 'v1')).toBe(false);
    expect(remoteChangedSinceSync('v2', '')).toBe(false);
    expect(remoteChangedSinceSync(undefined, undefined)).toBe(false);
  });
});
