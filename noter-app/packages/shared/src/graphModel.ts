/**
 * Knowledge-graph model — derive a graph of the user's entities (notes, project
 * folders, task-lists, tasks) and the relations between them, plus per-node stats.
 *
 * This is the pure data layer shared by mobile + Electron: the platform graph VIEW
 * renders `buildGraph(...)` output and lets the user click a node to open the
 * entity. The relations are simple and explicit (derived from the existing
 * parentId/parentNoteId links) and the included kinds + relations are configurable
 * via plain JSON (`GraphConfig`) — the user's "own graph database" knobs.
 *
 * Vector + GraphRAG search build ON this graph; see Doc/adr/0006 for the phased
 * roadmap (embeddings, dense/sparse, RRF routing, which device runs it).
 */
import type { Note, Task } from './types';
import { normalizeNoteType } from './noteType';

export type GraphNodeKind = 'note' | 'project' | 'task_list' | 'task';
export type GraphRelation = 'in_project' | 'in_list' | 'subtask';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Lightweight per-node statistics for the graph UI. */
  stats: {
    children: number;
    completed?: number;
    open?: number;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
  rel: GraphRelation;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphConfig {
  /** Which entity kinds to include as nodes (default: all). */
  include?: GraphNodeKind[];
  /** Which relations to draw (default: all). */
  relations?: GraphRelation[];
}

const DEFAULT_KINDS: GraphNodeKind[] = ['note', 'project', 'task_list', 'task'];
const DEFAULT_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask'];

const noteKind = (n: Note): GraphNodeKind => {
  const t = normalizeNoteType(n.type);
  return t === 'project' ? 'project' : t === 'task_list' ? 'task_list' : 'note';
};

/** Build the entity graph from notes + tasks, honouring an optional JSON config. */
export const buildGraph = (notes: Note[], tasks: Task[], config?: GraphConfig): GraphData => {
  const kinds = new Set(config?.include ?? DEFAULT_KINDS);
  const rels = new Set(config?.relations ?? DEFAULT_RELS);
  const liveNotes = (notes || []).filter((n) => n.deleted !== true && n.deleted !== 'true');
  const liveTasks = (tasks || []).filter((t) => t.deleted !== true && t.deleted !== 'true');

  // Pre-count children for stats.
  const childNoteCount = new Map<string, number>();
  for (const n of liveNotes) {
    if (n.parentId) childNoteCount.set(String(n.parentId), (childNoteCount.get(String(n.parentId)) || 0) + 1);
  }
  const listTaskCounts = new Map<string, { total: number; completed: number }>();
  const subtaskCount = new Map<string, number>();
  for (const t of liveTasks) {
    if (t.parentNoteId) {
      const c = listTaskCounts.get(String(t.parentNoteId)) || { total: 0, completed: 0 };
      c.total += 1; if (t.completed) c.completed += 1;
      listTaskCounts.set(String(t.parentNoteId), c);
    }
    if (t.parentId) subtaskCount.set(String(t.parentId), (subtaskCount.get(String(t.parentId)) || 0) + 1);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const n of liveNotes) {
    const kind = noteKind(n);
    if (!kinds.has(kind)) continue;
    const tc = listTaskCounts.get(n._id);
    nodes.push({
      id: n._id, kind, label: (n.title || '').trim() || '(namnlös)',
      stats: {
        children: (childNoteCount.get(n._id) || 0) + (kind === 'task_list' ? (tc?.total || 0) : 0),
        completed: kind === 'task_list' ? tc?.completed : undefined,
        open: kind === 'task_list' ? (tc ? tc.total - tc.completed : undefined) : undefined,
      },
    });
    nodeIds.add(n._id);
  }

  if (kinds.has('task')) {
    for (const t of liveTasks) {
      nodes.push({
        id: t._id, kind: 'task', label: (t.title || '').trim() || '(namnlös)',
        stats: { children: subtaskCount.get(t._id) || 0 },
      });
      nodeIds.add(t._id);
    }
  }

  // Edges from the existing parent links (only when both endpoints are present).
  for (const n of liveNotes) {
    if (!n.parentId || !nodeIds.has(n._id) || !nodeIds.has(String(n.parentId))) continue;
    const parent = liveNotes.find((p) => p._id === String(n.parentId));
    const rel: GraphRelation = parent && noteKind(parent) === 'task_list' ? 'in_list' : 'in_project';
    if (rels.has(rel)) edges.push({ source: n._id, target: String(n.parentId), rel });
  }
  for (const t of liveTasks) {
    if (t.parentId && rels.has('subtask') && nodeIds.has(t._id) && nodeIds.has(String(t.parentId))) {
      edges.push({ source: t._id, target: String(t.parentId), rel: 'subtask' });
    } else if (t.parentNoteId && rels.has('in_list') && nodeIds.has(t._id) && nodeIds.has(String(t.parentNoteId))) {
      edges.push({ source: t._id, target: String(t.parentNoteId), rel: 'in_list' });
    }
  }

  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Fast fulltext search — the "blixtsnabb" baseline (the cheapest search rung).
// Vector/GraphRAG layers fuse with this via RRF later (see ADR 0006).
// ---------------------------------------------------------------------------
export type SearchEntityKind = 'note' | 'project' | 'task_list' | 'task';
export interface SearchHit {
  id: string;
  kind: SearchEntityKind;
  title: string;
  score: number;
  snippet?: string;
}

// Split on whitespace/punctuation but keep letters (incl. åäö) + digits — avoids
// unicode-property regex so it compiles at the shared package's TS target.
const tokenize = (s: string): string[] =>
  (s || '').toLowerCase().split(/[\s,.;:!?"'`()[\]{}/\\|<>@#%^&*=+~-]+/).filter(Boolean);

/** Score one text against query tokens: title matches weigh more than body. */
const scoreText = (queryTokens: string[], title: string, body: string): number => {
  if (queryTokens.length === 0) return 0;
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  for (const q of queryTokens) {
    if (t.includes(q)) score += 3;
    if (b.includes(q)) score += 1;
  }
  return score;
};

/**
 * Fulltext search over notes + tasks. Pure + synchronous (no index needed for the
 * dataset sizes here); returns the top `limit` hits ranked by a simple weighted
 * token score. Decrypt content before passing it in.
 */
export const fulltextSearch = (
  notes: Note[],
  tasks: Task[],
  query: string,
  limit = 20,
): SearchHit[] => {
  const qt = tokenize(query);
  if (qt.length === 0) return [];
  const hits: SearchHit[] = [];

  for (const n of notes || []) {
    if (n.deleted === true || n.deleted === 'true') continue;
    const score = scoreText(qt, n.title || '', n.content || '');
    if (score > 0) {
      const kind = noteKind(n) as SearchEntityKind;
      hits.push({ id: n._id, kind, title: (n.title || '').trim() || '(namnlös)', score, snippet: (n.content || '').slice(0, 120) });
    }
  }
  for (const t of tasks || []) {
    if (t.deleted === true || t.deleted === 'true') continue;
    const score = scoreText(qt, t.title || '', t.description || '');
    if (score > 0) hits.push({ id: t._id, kind: 'task', title: (t.title || '').trim() || '(namnlös)', score, snippet: (t.description || '').slice(0, 120) });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};
