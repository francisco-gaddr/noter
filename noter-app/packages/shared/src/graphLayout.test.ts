import { layoutGraph, RELATION_COLORS, NODE_COLORS } from './graphLayout';
import { buildGraph } from './graphModel';
import type { Note, Task } from './types';

const note = (o: Partial<Note>): Note => ({ _id: o._id ?? 'n', userId: 'u', title: '', content: '', tags: [], locked: false, createdAt: '', updatedAt: '', ...o });
const task = (o: Partial<Task>): Task => ({ _id: o._id ?? 't', userId: 'u', title: '', completed: false, createdAt: '', updatedAt: '', ...o });

describe('layoutGraph', () => {
  const g = buildGraph(
    [note({ _id: 'proj', title: 'P', type: 'project' }), note({ _id: 'list', title: 'L', type: 'task_list', parentId: 'proj' })],
    [task({ _id: 'tA', title: 'A', parentNoteId: 'list' }), task({ _id: 'tB', title: 'B', parentNoteId: 'list' })],
  );

  it('positions every node within bounds and is deterministic', () => {
    const a = layoutGraph(g, { width: 800, height: 800 });
    const b = layoutGraph(g, { width: 800, height: 800 });
    expect(a.nodes.length).toBe(g.nodes.length);
    for (const n of a.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(800);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(800);
      expect(n.r).toBeGreaterThan(0);
    }
    expect(a.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]))
      .toEqual(b.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)])); // same input → same layout
  });

  it('carries edges through and exposes colour maps', () => {
    const l = layoutGraph(g);
    expect(l.edges).toEqual(g.edges);
    expect(RELATION_COLORS.linked).toBeTruthy();
    expect(NODE_COLORS.project).toBeTruthy();
  });

  it('handles an empty graph', () => {
    expect(layoutGraph({ nodes: [], edges: [] }).nodes).toEqual([]);
  });
});
