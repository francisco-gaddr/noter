import {
  defaultNeo4jConfig,
  parseNeo4jConfig,
  serializeNeo4jConfig,
  selectForNeo4j,
  buildCypherSync,
  buildCypherPrune,
  buildNeo4jSyncPlan,
} from './neo4jSync';
import type { Note, Task } from './types';

const note = (id: string, type: Note['type'], parentId?: string, extra: Partial<Note> = {}): Note => ({
  _id: id, userId: 'u', title: id, content: 'body-' + id, tags: [], locked: false,
  parentId: parentId ?? null, type, createdAt: '', updatedAt: '', ...extra,
});
const task = (id: string, parentNoteId: string): Task => ({
  _id: id, userId: 'u', title: id, completed: false, parentNoteId, createdAt: '', updatedAt: '',
});

describe('neo4jSync config', () => {
  it('round-trips and tolerates junk', () => {
    const c = { ...defaultNeo4jConfig(), enabled: true, projectFolderIds: ['p1'], includeBody: true };
    expect(parseNeo4jConfig(serializeNeo4jConfig(c))).toEqual(c);
    expect(parseNeo4jConfig('garbage')).toEqual(defaultNeo4jConfig());
    expect(parseNeo4jConfig({ projectFolderIds: ['a', 2, 'b'] }).projectFolderIds).toEqual(['a', 'b']);
  });
});

describe('neo4jSync selection (per-folder + lock guard)', () => {
  // proj (selected) → childNote; otherProj (NOT selected) → otherNote
  // list (selected, task-list) → has task t1
  const notes: Note[] = [
    note('proj', 'project'),
    note('childNote', 'note', 'proj'),
    note('deep', 'note', 'childNote'),
    note('otherProj', 'project'),
    note('otherNote', 'note', 'otherProj'),
    note('list', 'task_list'),
  ];
  const tasks: Task[] = [task('t1', 'list')];

  it('includes only descendants of selected folders', () => {
    const cfg = { ...defaultNeo4jConfig(), enabled: true, projectFolderIds: ['proj'], taskListIds: ['list'] };
    const sel = selectForNeo4j(notes, tasks, cfg);
    const ids = sel.notes.map((n) => n._id).sort();
    expect(ids).toEqual(['childNote', 'deep', 'list', 'proj']);
    expect(sel.notes.map((n) => n._id)).not.toContain('otherNote');
    expect(sel.tasks.map((t) => t._id)).toEqual(['t1']);
  });

  it('NEVER mirrors a locked folder or its descendants', () => {
    const locked = notes.map((n) => (n._id === 'proj' ? { ...n, locked: true } : n));
    const cfg = { ...defaultNeo4jConfig(), enabled: true, projectFolderIds: ['proj'] };
    const sel = selectForNeo4j(locked, tasks, cfg);
    expect(sel.notes).toEqual([]); // proj locked → whole subtree excluded
  });
});

describe('neo4jSync Cypher generation', () => {
  const notes: Note[] = [note('proj', 'project'), note('childNote', 'note', 'proj')];
  const cfg = { ...defaultNeo4jConfig(), enabled: true, projectFolderIds: ['proj'] };

  it('emits parameterized MERGE node + relationship statements', () => {
    const sel = selectForNeo4j(notes, [], cfg);
    const stmts = buildCypherSync('u', sel, cfg);
    const nodeStmt = stmts.find((s) => s.text.indexOf('MERGE (n:NoterNode') === 0)!;
    expect(nodeStmt.params.userId).toBe('u');
    expect(nodeStmt.text).toContain('$uid');
    expect(nodeStmt.text).not.toContain('body'); // includeBody false → no body prop
    // childNote → proj is an in_project edge
    const relStmt = stmts.find((s) => s.text.indexOf('MERGE (a)-[r:IN_PROJECT]') !== -1)!;
    expect(relStmt).toBeTruthy();
    expect(relStmt.params).toEqual({ s: 'childNote', t: 'proj' });
  });

  it('includes body only when opted in', () => {
    const sel = selectForNeo4j(notes, [], cfg);
    const withBody = buildCypherSync('u', sel, { ...cfg, includeBody: true });
    const nodeStmt = withBody.find((s) => s.text.indexOf('MERGE (n:NoterNode') === 0)!;
    expect(nodeStmt.text).toContain('n.body=$body');
    expect(nodeStmt.params.body).toBe('body-proj');
  });

  it('prune keeps exactly the in-scope ids and is parameterized', () => {
    const sel = selectForNeo4j(notes, [], cfg);
    const prune = buildCypherPrune('u', sel);
    expect(prune.text).toContain('WHERE NOT n.uid IN $keep DETACH DELETE n');
    expect((prune.params.keep as string[]).sort()).toEqual(['childNote', 'proj']);
    expect(prune.params.userId).toBe('u');
  });

  it('full plan is empty when disabled, prune-first when enabled', () => {
    expect(buildNeo4jSyncPlan('u', notes, [], { ...cfg, enabled: false })).toEqual([]);
    const plan = buildNeo4jSyncPlan('u', notes, [], cfg);
    expect(plan[0].text).toContain('DETACH DELETE');
    expect(plan.length).toBeGreaterThan(1);
  });
});
