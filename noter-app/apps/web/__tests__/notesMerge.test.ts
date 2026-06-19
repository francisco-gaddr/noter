import { applyNoteUpdate } from '../stores/notesMerge';

/**
 * Regression guard for the `note:updated` realtime merge (fix 49661ea — "rAF lost-write").
 * The merge must substitute ONLY the updated note into the CURRENT array, honour
 * last-writer-wins by `updatedAt`, and never throw on malformed timestamps.
 */
const note = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, updatedAt, ...extra }) as any;

describe('applyNoteUpdate', () => {
  it('substitutes an existing note in place, preserving order', () => {
    const cur = [note('a', '2026-01-01T00:00:00Z'), note('b', '2026-01-01T00:00:00Z'), note('c', '2026-01-01T00:00:00Z')];
    const out = applyNoteUpdate(cur, note('b', '2026-02-01T00:00:00Z', { title: 'new' }));
    expect(out).not.toBeNull();
    expect(out!.map((n) => n._id)).toEqual(['a', 'b', 'c']); // order preserved
    expect((out!.find((n) => n._id === 'b') as any).title).toBe('new');
    expect(out!.find((n) => n._id === 'a')).toBe(cur[0]); // untouched notes are the SAME ref
  });

  it('prepends an unknown note (newest-first) and keeps every existing note', () => {
    const cur = [note('a', '2026-01-01T00:00:00Z')];
    const out = applyNoteUpdate(cur, note('z', '2026-01-02T00:00:00Z'));
    expect(out!.map((n) => n._id)).toEqual(['z', 'a']);
  });

  it('ignores a remote echo when the local copy is strictly newer (returns null)', () => {
    const cur = [note('a', '2026-03-01T00:00:00Z')];
    const out = applyNoteUpdate(cur, note('a', '2026-01-01T00:00:00Z'));
    expect(out).toBeNull();
  });

  it('accepts the remote on equal timestamps (idempotent, remote-newer-or-equal wins)', () => {
    const cur = [note('a', '2026-01-01T00:00:00Z', { title: 'old' })];
    const out = applyNoteUpdate(cur, note('a', '2026-01-01T00:00:00Z', { title: 'same-ts-new-body' }));
    expect(out).not.toBeNull();
    expect((out![0] as any).title).toBe('same-ts-new-body');
  });

  it('never throws on malformed timestamps — accepts the remote (NaN compare falls through)', () => {
    const cur = [note('a', 'not-a-date', { title: 'old' })];
    const out = applyNoteUpdate(cur, note('a', 'also-bad', { title: 'new' }));
    expect(out).not.toBeNull();
    expect((out![0] as any).title).toBe('new');
  });

  it('does not mutate the input array', () => {
    const cur = [note('a', '2026-01-01T00:00:00Z')];
    const snapshot = [...cur];
    applyNoteUpdate(cur, note('b', '2026-02-01T00:00:00Z'));
    expect(cur).toEqual(snapshot);
  });
});
