import { resolveConflict, applyConflictChoices } from '../../services/syncConflict';

describe('resolveConflict', () => {
  it('identical when local and remote match', () => {
    const r = resolveConflict({
      base: { a: 1 },
      local: { a: 1, b: 2 },
      remote: { a: 1, b: 2 },
    });
    expect(r.kind).toBe('identical');
  });

  it('remote-only when only the server changed', () => {
    const r = resolveConflict({
      base: { title: 'A', body: 'x' },
      local: { title: 'A', body: 'x' },
      remote: { title: 'B', body: 'x' },
    });
    expect(r.kind).toBe('remote-only');
    if (r.kind === 'remote-only') {
      expect(r.merged.title).toBe('B');
      expect(r.touchedFields).toEqual(['title']);
    }
  });

  it('local-only when only the device changed', () => {
    const r = resolveConflict({
      base: { title: 'A' },
      local: { title: 'A-edited' },
      remote: { title: 'A' },
    });
    expect(r.kind).toBe('local-only');
  });

  it('auto-merges disjoint changes (local edits title, remote edits body)', () => {
    const r = resolveConflict({
      base: { title: 'A', body: 'b' },
      local: { title: 'A2', body: 'b' },
      remote: { title: 'A', body: 'b2' },
    });
    expect(r.kind).toBe('auto-merge');
    if (r.kind === 'auto-merge') {
      expect(r.merged).toEqual({ title: 'A2', body: 'b2' });
      expect(r.touchedFields.sort()).toEqual(['body', 'title']);
    }
  });

  it('returns requires-prompt when same field diverges differently', () => {
    const r = resolveConflict({
      base: { title: 'A' },
      local: { title: 'Local' },
      remote: { title: 'Remote' },
    });
    expect(r.kind).toBe('requires-prompt');
    if (r.kind === 'requires-prompt') {
      expect(r.conflicts).toHaveLength(1);
      expect(r.conflicts[0].field).toBe('title');
    }
  });

  it('no conflict when both sides applied the same edit', () => {
    const r = resolveConflict({
      base: { title: 'A' },
      local: { title: 'B' },
      remote: { title: 'B' },
    });
    expect(r.kind).toBe('identical');
  });

  it('handles nested objects deeply', () => {
    const r = resolveConflict({
      base: { meta: { tags: ['a'] } },
      local: { meta: { tags: ['a'] } },
      remote: { meta: { tags: ['a', 'b'] } },
    });
    expect(r.kind).toBe('remote-only');
  });
});

describe('applyConflictChoices', () => {
  const base = { title: 'A', body: 'b' };
  const local = { title: 'L', body: 'b' };
  const remote = { title: 'R', body: 'b' };

  it('applies "local" choice', () => {
    const r = resolveConflict({ base, local, remote });
    if (r.kind !== 'requires-prompt') throw new Error('expected prompt');
    const merged = applyConflictChoices({ base, local, remote }, r.conflicts, { title: 'local' });
    expect(merged.title).toBe('L');
  });

  it('applies "remote" choice', () => {
    const r = resolveConflict({ base, local, remote });
    if (r.kind !== 'requires-prompt') throw new Error('expected prompt');
    const merged = applyConflictChoices({ base, local, remote }, r.conflicts, { title: 'remote' });
    expect(merged.title).toBe('R');
  });

  it('applies custom value', () => {
    const r = resolveConflict({ base, local, remote });
    if (r.kind !== 'requires-prompt') throw new Error('expected prompt');
    const merged = applyConflictChoices({ base, local, remote }, r.conflicts, {
      title: { kind: 'custom', value: 'Custom' },
    });
    expect(merged.title).toBe('Custom');
  });

  it('defaults to local when no choice given', () => {
    const r = resolveConflict({ base, local, remote });
    if (r.kind !== 'requires-prompt') throw new Error('expected prompt');
    const merged = applyConflictChoices({ base, local, remote }, r.conflicts, {});
    expect(merged.title).toBe('L');
  });
});
