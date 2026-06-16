/**
 * Selective Neo4j sync — pure config + Cypher generation. Lets the user pick EXACTLY which
 * project folders, task-lists and ingested file-folders are mirrored into a SELF-HOSTED
 * Neo4j (their own, never a managed cloud), so the knowledge graph can be queried with
 * Cypher / server-side GraphRAG. Everything here is IO-free and ES5-safe; a platform service
 * drives a real bolt driver with the statements this module emits.
 *
 * SECURITY:
 *  - Only DESCENDANTS of the user-selected folders are mirrored — nothing else leaves.
 *  - The lock guard (isReadableWithLocks) is applied, so a locked note/folder is NEVER
 *    mirrored to Neo4j, exactly like the AI index and the markdown projection.
 *  - `includeBody` defaults to FALSE: by default only structure + titles are mirrored
 *    (most E2E-preserving). Mirroring bodies is an explicit opt-in the user makes for their
 *    own self-hosted store.
 *  - All statements are PARAMETERIZED (no string interpolation of user data → no Cypher
 *    injection). Relationship types come from our own fixed enum, never user input.
 */
import type { Note, Task } from './types';
import { buildGraph, type GraphRelation } from './graphModel';
import { buildSecurityNoteMap, isReadableWithLocks, type SecurityNote } from './locks';

export interface Neo4jConfig {
  enabled: boolean;
  /** bolt:// or neo4j+s:// URL of the SELF-HOSTED instance. */
  boltUrl: string;
  /** Optional advanced override: Neo4j HTTP transactional URL the backend relay should use
   *  (e.g. http://neo4j:7474). Empty = use the server's configured default (the normal case). */
  httpUrl?: string;
  database: string;
  username: string;
  /** Selected project-folder note ids whose subtree is mirrored. */
  projectFolderIds: string[];
  /** Selected task-list note ids whose tasks are mirrored. */
  taskListIds: string[];
  /** Selected ingested file-folder note ids (Nextcloud folders) whose subtree is mirrored. */
  fileFolderIds: string[];
  /** Mirror note/task bodies too (plaintext in your Neo4j), not just titles + structure. */
  includeBody: boolean;
}

export const defaultNeo4jConfig = (): Neo4jConfig => ({
  enabled: false,
  boltUrl: '',
  httpUrl: '',
  database: 'neo4j',
  username: 'neo4j',
  projectFolderIds: [],
  taskListIds: [],
  fileFolderIds: [],
  includeBody: false,
});

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') as string[] : [];

export const parseNeo4jConfig = (raw: unknown): Neo4jConfig => {
  const d = defaultNeo4jConfig();
  let o: any = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return d; } }
  if (!o || typeof o !== 'object') return d;
  return {
    enabled: !!o.enabled,
    boltUrl: typeof o.boltUrl === 'string' ? o.boltUrl : d.boltUrl,
    httpUrl: typeof o.httpUrl === 'string' ? o.httpUrl : d.httpUrl,
    database: typeof o.database === 'string' && o.database ? o.database : d.database,
    username: typeof o.username === 'string' && o.username ? o.username : d.username,
    projectFolderIds: strArr(o.projectFolderIds),
    taskListIds: strArr(o.taskListIds),
    fileFolderIds: strArr(o.fileFolderIds),
    includeBody: !!o.includeBody,
  };
};

export const serializeNeo4jConfig = (c: Neo4jConfig): string => JSON.stringify(c);

/** A parameterized Cypher statement — feed straight into a bolt session.run(text, params). */
export interface CypherStatement {
  text: string;
  params: Record<string, unknown>;
}

export interface Neo4jSelection {
  notes: Note[];
  tasks: Task[];
  /** Distinct selected-folder ids (union of the three categories), for stats/UI. */
  selectedFolderIds: string[];
}

const REL_TO_TYPE: Record<GraphRelation, string> = {
  in_project: 'IN_PROJECT',
  in_list: 'IN_LIST',
  subtask: 'SUBTASK',
  sibling: 'SIBLING',
  same_due: 'SAME_DUE',
  linked: 'LINKED',
};

/** Collect a folder id plus every descendant note id (notes nested via parentId). */
const collectSubtreeNoteIds = (rootIds: Set<string>, notes: Note[]): Set<string> => {
  const childrenOf = new Map<string, string[]>();
  for (const n of notes) {
    const p = n.parentId ? String(n.parentId) : '';
    if (!p) continue;
    const arr = childrenOf.get(p) || [];
    arr.push(n._id);
    childrenOf.set(p, arr);
  }
  const out = new Set<string>();
  const stack = Array.from(rootIds);
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of childrenOf.get(id) || []) stack.push(c);
  }
  return out;
};

/**
 * Resolve which notes + tasks are in scope for Neo4j given the per-folder selection, with
 * the lock guard applied. A task is included when its parent list is a selected/scoped note.
 */
export const selectForNeo4j = (
  notes: Note[],
  tasks: Task[],
  config: Neo4jConfig,
  unlockedIds: Set<string> = new Set(),
): Neo4jSelection => {
  const selectedFolderIds = Array.from(new Set([
    ...config.projectFolderIds,
    ...config.taskListIds,
    ...config.fileFolderIds,
  ].filter(Boolean)));

  const live = notes.filter((n) => !n.deleted);
  const scopeIds = collectSubtreeNoteIds(new Set(selectedFolderIds), live);

  const secMap = buildSecurityNoteMap(live as unknown as SecurityNote[]);
  const readable = (id: string): boolean =>
    isReadableWithLocks(secMap.get(id), secMap, unlockedIds);

  const noteSet = live.filter((n) => scopeIds.has(n._id) && readable(n._id));
  const noteIdSet = new Set(noteSet.map((n) => n._id));

  const taskSet = tasks.filter((t) => {
    if (t.deleted) return false;
    const parent = t.parentNoteId ? String(t.parentNoteId) : '';
    // A task is in scope when its list is scoped + readable.
    return parent && noteIdSet.has(parent);
  });

  return { notes: noteSet, tasks: taskSet, selectedFolderIds };
};

/**
 * Build the full set of MERGE statements (nodes + relationships) for the current selection.
 * Idempotent — running it repeatedly converges. Node identity is `uid` (the note/task id),
 * scoped by `userId` so multiple users never collide in a shared instance.
 */
export const buildCypherSync = (
  userId: string,
  selection: Neo4jSelection,
  config: Neo4jConfig,
): CypherStatement[] => {
  const stmts: CypherStatement[] = [];
  const inScope = new Set<string>();
  selection.notes.forEach((n) => inScope.add(n._id));
  selection.tasks.forEach((t) => inScope.add(t._id));

  const upsertNode = (uid: string, kind: string, title: string, body?: string): void => {
    const params: Record<string, unknown> = { uid, userId, kind, title: title || '' };
    let set = 'SET n.kind=$kind, n.title=$title, n.userId=$userId';
    if (config.includeBody && typeof body === 'string') {
      params.body = body;
      set += ', n.body=$body';
    }
    stmts.push({ text: 'MERGE (n:NoterNode {uid:$uid}) ' + set, params });
  };

  for (const n of selection.notes) {
    upsertNode(n._id, n.type || 'note', n.title, n.content);
  }
  for (const t of selection.tasks) {
    upsertNode(t._id, 'task', t.title, t.description);
  }

  // Edges among in-scope entities only, derived from the canonical graph model.
  const graph = buildGraph(selection.notes, selection.tasks);
  for (const e of graph.edges) {
    if (!inScope.has(e.source) || !inScope.has(e.target)) continue;
    const relType = REL_TO_TYPE[e.rel];
    if (!relType) continue;
    stmts.push({
      text:
        'MATCH (a:NoterNode {uid:$s}), (b:NoterNode {uid:$t}) ' +
        'MERGE (a)-[r:' + relType + ']->(b)',
      params: { s: e.source, t: e.target },
    });
  }
  return stmts;
};

/**
 * Prune statement: delete every node for this user that is NOT in the current in-scope set
 * (handles deselected folders, deleted notes, and content that became locked). DETACH DELETE
 * also removes its relationships.
 */
export const buildCypherPrune = (userId: string, selection: Neo4jSelection): CypherStatement => {
  const keep = [
    ...selection.notes.map((n) => n._id),
    ...selection.tasks.map((t) => t._id),
  ];
  return {
    text: 'MATCH (n:NoterNode {userId:$userId}) WHERE NOT n.uid IN $keep DETACH DELETE n',
    params: { userId, keep },
  };
};

/** Convenience: the full idempotent sync plan (prune stale, then upsert in-scope). */
export const buildNeo4jSyncPlan = (
  userId: string,
  notes: Note[],
  tasks: Task[],
  config: Neo4jConfig,
  unlockedIds: Set<string> = new Set(),
): CypherStatement[] => {
  if (!config.enabled) return [];
  const selection = selectForNeo4j(notes, tasks, config, unlockedIds);
  return [buildCypherPrune(userId, selection), ...buildCypherSync(userId, selection, config)];
};
