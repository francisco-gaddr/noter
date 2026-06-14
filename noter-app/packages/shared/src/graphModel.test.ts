import { buildGraph, fulltextSearch, neighborsOf, filterGraphByQuery, sortGraphNodes } from './graphModel';
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

  it('neighborsOf returns incoming + outgoing relations of a node', () => {
    const g = buildGraph(notes, tasks);
    const nb = neighborsOf(g, 'list')!;
    expect(nb.node.id).toBe('list');
    // list → proj (outgoing, in_project), taskA/taskB → list (incoming, in_list)
    expect(nb.outgoing.map((o) => o.node.id)).toContain('proj');
    expect(nb.incoming.map((i) => i.node.id).sort()).toEqual(['taskA', 'taskB']);
    expect(neighborsOf(g, 'missing')).toBeNull();
  });

  it('derives sibling edges for notes in the same project + tasks in the same list', () => {
    const ns = [
      note({ _id: 'proj', title: 'P', type: 'project' }),
      note({ _id: 'a', title: 'A', parentId: 'proj' }),
      note({ _id: 'b', title: 'B', parentId: 'proj' }),
    ];
    const g = buildGraph(ns, [], { deriveSiblings: true });
    expect(g.edges).toContainEqual({ source: 'a', target: 'b', rel: 'sibling' });
  });

  it('derives same-due edges between tasks on the same day, and respects the group cap', () => {
    const ts = [
      task({ _id: 't1', title: '1', dueDate: '2026-06-20T09:00:00Z' }),
      task({ _id: 't2', title: '2', dueDate: '2026-06-20T18:00:00Z' }),
      task({ _id: 't3', title: '3', dueDate: '2026-06-21T09:00:00Z' }),
    ];
    const g = buildGraph([], ts, { deriveSameDue: true });
    expect(g.edges.some((e) => e.rel === 'same_due' && e.source === 't1' && e.target === 't2')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'same_due' && (e.source === 't3' || e.target === 't3'))).toBe(false);
    // group cap: a big same-day group skips pairwise to avoid an N² explosion
    const many = Array.from({ length: 5 }, (_, i) => task({ _id: `m${i}`, title: String(i), dueDate: '2026-07-01T09:00:00Z' }));
    expect(buildGraph([], many, { deriveSameDue: true, siblingGroupCap: 3 }).edges.length).toBe(0);
  });

  it('renders explicit user-drawn links as "linked" edges', () => {
    const ns = [
      note({ _id: 'a', title: 'A', links: [{ targetId: 'b', rel: 'linked' }] }),
      note({ _id: 'b', title: 'B' }),
    ];
    expect(buildGraph(ns, []).edges).toContainEqual({ source: 'a', target: 'b', rel: 'linked' });
    // a link to a missing node is dropped
    const ns2 = [note({ _id: 'a', links: [{ targetId: 'gone', rel: 'linked' }] })];
    expect(buildGraph(ns2, []).edges.some((e) => e.rel === 'linked')).toBe(false);
  });

  it('does not derive sibling/same-due edges by default', () => {
    const ns = [note({ _id: 'proj', title: 'P', type: 'project' }), note({ _id: 'a', parentId: 'proj' }), note({ _id: 'b', parentId: 'proj' })];
    expect(buildGraph(ns, []).edges.some((e) => e.rel === 'sibling')).toBe(false);
  });

  it('sortGraphNodes orders by label / kind / connections', () => {
    const g = buildGraph(notes, tasks);
    expect(sortGraphNodes(g, 'label').map((n) => n.label)).toEqual([...g.nodes.map((n) => n.label)].sort((a, b) => a.localeCompare(b, 'sv')));
    // by kind: project first, task last
    const byKind = sortGraphNodes(g, 'kind');
    expect(byKind[0].kind).toBe('project');
    // by connections: the list (hub of taskA/taskB + project) ranks at/near the top
    expect(sortGraphNodes(g, 'connections')[0].id).toBe('list');
  });

  it('filterGraphByQuery keeps matches plus their direct neighbours', () => {
    const g = buildGraph(notes, tasks);
    const f = filterGraphByQuery(g, 'lista'); // matches the "Lista" task_list
    const ids = f.nodes.map((n) => n.id);
    expect(ids).toContain('list');
    expect(ids).toContain('proj'); // one hop out
    expect(ids).toContain('taskA'); // one hop in
    expect(filterGraphByQuery(g, '')).toBe(g); // empty query → original
    expect(filterGraphByQuery(g, 'zzz').nodes).toEqual([]); // no match → empty
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
