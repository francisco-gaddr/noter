import { relatedNotes } from './relatedNotes';
import type { VectorIndex } from './vectorStore';
import type { Note, Task } from './types';

const vec = (id: string, vector: number[], title = id): VectorIndex['items'][number] => ({
  id, kind: 'note', title, vector, hash: 'h', model: 'm', at: 1,
});

// A=current, B=similar, C=less similar, L=locked-but-near-identical (must be filtered out).
const index: VectorIndex = {
  model: 'm',
  items: [
    vec('A', [1, 0, 0]),
    vec('B', [0.9, 0.1, 0]),
    vec('C', [0.4, 0.6, 0]),
    vec('L', [1, 0, 0]),
  ],
};

const note = (id: string, locked = false): Note => ({
  _id: id, title: id, content: '', type: 'note', parentId: null, locked, deleted: false,
} as unknown as Note);

const notes: Note[] = [note('A'), note('B'), note('C'), note('L', true)];
const tasks: Task[] = [];

describe('relatedNotes', () => {
  it('ranks the most similar readable notes, excluding the note itself', () => {
    const out = relatedNotes(index, 'A', notes, tasks, 5);
    expect(out.map((r) => r.id)).not.toContain('A'); // never returns itself
    expect(out[0].id).toBe('B'); // most similar readable
    expect(out.map((r) => r.id)).toContain('C');
    expect(out[0].score).toBeGreaterThan(out[1].score); // score-desc
  });

  it('NEVER surfaces a locked note, even when its vector is identical (lock invariant)', () => {
    const out = relatedNotes(index, 'A', notes, tasks, 5);
    expect(out.map((r) => r.id)).not.toContain('L'); // L is locked → filtered despite cosine 1.0
  });

  it('returns nothing when the current note is itself locked (no deriving from locked content)', () => {
    const lockedSelf = [note('A', true), note('B'), note('C')];
    expect(relatedNotes(index, 'A', lockedSelf, tasks, 5)).toEqual([]);
  });

  it('returns nothing when the current note is not yet embedded', () => {
    expect(relatedNotes(index, 'missing', notes, tasks, 5)).toEqual([]);
  });

  it('honours the limit', () => {
    expect(relatedNotes(index, 'A', notes, tasks, 1)).toHaveLength(1);
  });
});
