import { diffIndex, emptyVectorIndex, makeStoredVector, indexToEmbeddedItems, entitySignature, buildIndexableEntities } from './vectorStore';
import type { IndexableEntity, VectorIndex } from './vectorStore';
import type { Note, Task } from './types';

const ent = (id: string, title: string, body = ''): IndexableEntity => ({ id, kind: 'note', title, body });

describe('diffIndex', () => {
  it('embeds everything against an empty index', () => {
    const d = diffIndex([ent('a', 'A'), ent('b', 'B')], emptyVectorIndex('nomic-embed-text'), 'nomic-embed-text');
    expect(d.toEmbed.map((e) => e.id)).toEqual(['a', 'b']);
    expect(d.keep).toEqual([]);
    expect(d.removed).toBe(0);
  });

  it('keeps unchanged rows and re-embeds changed content', () => {
    const a = ent('a', 'A', 'one');
    const index: VectorIndex = { model: 'm', items: [makeStoredVector(a, [1, 0], 'm')] };
    const d = diffIndex([ent('a', 'A', 'one'), ent('a2', 'A2', 'x')].slice(0, 1).concat(ent('a', 'A', 'CHANGED')), index, 'm');
    // 'a' appears with changed body → must re-embed; nothing kept
    expect(d.toEmbed.some((e) => e.id === 'a')).toBe(true);
  });

  it('re-embeds all rows when the model changes', () => {
    const a = ent('a', 'A', 'one');
    const index: VectorIndex = { model: 'old', items: [makeStoredVector(a, [1, 0], 'old')] };
    const d = diffIndex([a], index, 'new');
    expect(d.toEmbed.map((e) => e.id)).toEqual(['a']);
    expect(d.keep).toEqual([]);
  });

  it('keeps a row when hash + model match', () => {
    const a = ent('a', 'A', 'one');
    const index: VectorIndex = { model: 'm', items: [makeStoredVector(a, [1, 0], 'm')] };
    const d = diffIndex([a], index, 'm');
    expect(d.toEmbed).toEqual([]);
    expect(d.keep.map((r) => r.id)).toEqual(['a']);
  });

  it('counts removed rows whose entity vanished', () => {
    const index: VectorIndex = { model: 'm', items: [makeStoredVector(ent('a', 'A'), [1], 'm'), makeStoredVector(ent('b', 'B'), [1], 'm')] };
    const d = diffIndex([ent('a', 'A')], index, 'm');
    expect(d.removed).toBe(1);
  });
});

describe('entitySignature', () => {
  it('changes when content changes, stable otherwise', () => {
    expect(entitySignature(ent('a', 'T', 'x'))).toBe(entitySignature(ent('a', 'T', 'x')));
    expect(entitySignature(ent('a', 'T', 'x'))).not.toBe(entitySignature(ent('a', 'T', 'y')));
  });
});

describe('buildIndexableEntities (lock guard)', () => {
  const note = (over: Partial<Note>): Note => ({ _id: 'n', userId: 'u', title: 'T', content: 'C', tags: [], locked: false, createdAt: '', updatedAt: '', ...over });
  const task = (over: Partial<Task>): Task => ({ _id: 't', userId: 'u', title: 'TT', completed: false, createdAt: '', updatedAt: '', ...over });

  it('excludes locked notes and their child tasks', () => {
    const notes = [note({ _id: 'open' }), note({ _id: 'locked', locked: true, type: 'project' })];
    const tasks = [task({ _id: 't1', parentNoteId: 'open' }), task({ _id: 't2', parentNoteId: 'locked' })];
    const ids = buildIndexableEntities(notes, tasks).map((e) => e.id).sort();
    expect(ids).toEqual(['open', 't1']);
  });

  it('includes a locked note once it is in the unlocked set', () => {
    const notes = [note({ _id: 'locked', locked: true })];
    expect(buildIndexableEntities(notes, [], new Set(['locked'])).map((e) => e.id)).toEqual(['locked']);
  });

  it('excludes tasks under a locked child note even if the project root is open', () => {
    const notes = [note({ _id: 'proj', type: 'project' }), note({ _id: 'sub', parentId: 'proj', locked: true })];
    const tasks = [task({ _id: 'tk', parentNoteId: 'sub' })];
    expect(buildIndexableEntities(notes, tasks).map((e) => e.id).sort()).toEqual(['proj']);
  });

  it('skips deleted notes and tasks', () => {
    const notes = [note({ _id: 'a', deleted: true })];
    const tasks = [task({ _id: 'b', deleted: 'true' })];
    expect(buildIndexableEntities(notes, tasks)).toEqual([]);
  });
});

describe('indexToEmbeddedItems', () => {
  it('drops empty vectors and maps to EmbeddedItem', () => {
    const index: VectorIndex = { model: 'm', items: [makeStoredVector(ent('a', 'A', 'b'), [1, 2], 'm'), makeStoredVector(ent('z', 'Z'), [], 'm')] };
    const items = indexToEmbeddedItems(index);
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(items[0].vector).toEqual([1, 2]);
  });
});
