import { buildGraph, fulltextSearch } from './graphModel';
import type { Note, Task } from './types';

const note = (o: Partial<Note>): Note => ({ _id: o._id ?? 'n', userId: 'u', title: '', content: '', tags: [], locked: false, createdAt: '', updatedAt: '', ...o });
const task = (o: Partial<Task>): Task => ({ _id: o._id ?? 't', userId: 'u', title: '', completed: false, createdAt: '', updatedAt: '', ...o });

describe('buildGraph', () => {
  const notes = [
    note({ _id: 'proj', title: 'Projekt', type: 'project' }),
    note({ _id: 'list', title: 'Lista', type: 'task_list', parentId: 'proj' }),
    note({ _id: 'memo', title: 'Memo', type: 'note', parentId: 'proj' }),
  ];
  const tasks = [
    task({ _id: 'taskA', title: 'A', parentNoteId: 'list', completed: true }),
    task({ _id: 'taskB', title: 'B', parentNoteId: 'list' }),
    task({ _id: 'sub', title: 'Sub', parentId: 'taskB' }),
  ];

  it('builds nodes for every kind with stats', () => {
    const g = buildGraph(notes, tasks);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['list', 'memo', 'proj', 'sub', 'taskA', 'taskB']);
    const list = g.nodes.find((n) => n.id === 'list')!;
    expect(list.stats).toMatchObject({ completed: 1, open: 1 }); // 2 tasks, 1 done
  });

  it('draws parent edges (in_project / in_list / subtask)', () => {
    const g = buildGraph(notes, tasks);
    expect(g.edges).toContainEqual({ source: 'list', target: 'proj', rel: 'in_list' === 'in_list' ? 'in_project' : 'in_project' }); // list's parent is the project
    expect(g.edges).toContainEqual({ source: 'taskA', target: 'list', rel: 'in_list' });
    expect(g.edges).toContainEqual({ source: 'sub', target: 'taskB', rel: 'subtask' });
  });

  it('respects the include config (tasks excluded)', () => {
    const g = buildGraph(notes, tasks, { include: ['project', 'task_list', 'note'] });
    expect(g.nodes.some((n) => n.kind === 'task')).toBe(false);
  });
});

describe('fulltextSearch', () => {
  it('ranks title matches above body, returns hits', () => {
    const notes = [note({ _id: 'a', title: 'Recept kakor', content: 'mjöl socker' }), note({ _id: 'b', title: 'Annat', content: 'kakor är gott' })];
    const hits = fulltextSearch(notes, [], 'kakor');
    expect(hits[0].id).toBe('a'); // title match wins
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('returns [] for empty query and skips deleted', () => {
    expect(fulltextSearch([note({ title: 'x' })], [], '')).toEqual([]);
    expect(fulltextSearch([note({ _id: 'd', title: 'kakor', deleted: true })], [], 'kakor')).toEqual([]);
  });
});
