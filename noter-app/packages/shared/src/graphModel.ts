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
export type GraphRelation = 'in_project' | 'in_list' | 'subtask' | 'sibling' | 'same_due' | 'linked';

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
  /** Which relations to draw (default: the structural ones). */
  relations?: GraphRelation[];
  /**
   * Derive automatic "co-location" sibling edges: notes sharing the same project, and
   * tasks sharing the same list, are linked to each other (capped per group to avoid an
   * N² explosion). Off by default — the view toggles it.
   */
  deriveSiblings?: boolean;
  /** Derive "same due-day" edges between tasks that fall on the same date. */
  deriveSameDue?: boolean;
  /** Max group size for full pairwise sibling/same-due linking (bigger groups skip it). */
  siblingGroupCap?: number;
}

const DEFAULT_KINDS: GraphNodeKind[] = ['note', 'project', 'task_list', 'task'];
const DEFAULT_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask', 'linked'];
const DEFAULT_SIBLING_CAP = 8;

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

  // Explicit user-drawn links (note.links / task.links) — always shown when present.
  const addExplicitLinks = (items: { _id: string; links?: { targetId: string; rel: string }[] }[]) => {
    for (const it of items) {
      if (!nodeIds.has(it._id) || !Array.isArray(it.links)) continue;
      for (const link of it.links) {
        const target = String(link?.targetId || '');
        if (target && nodeIds.has(target)) edges.push({ source: it._id, target, rel: 'linked' });
      }
    }
  };
  if (rels.has('linked')) { addExplicitLinks(liveNotes); addExplicitLinks(liveTasks); }

  // --- Derived "co-location" edges (opt-in via config) -----------------------
  const cap = config?.siblingGroupCap ?? DEFAULT_SIBLING_CAP;
  // Full pairwise edges within a group, but only when the group is small enough that
  // the pairwise count stays reasonable (else the structural hub node carries it).
  const pairwise = (ids: string[], rel: GraphRelation) => {
    const present = ids.filter((id) => nodeIds.has(id));
    if (present.length < 2 || present.length > cap) return;
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        edges.push({ source: present[i], target: present[j], rel });
      }
    }
  };

  if (config?.deriveSiblings) {
    // Notes sharing the same parent project/list, grouped by parentId.
    const byParent = new Map<string, string[]>();
    for (const n of liveNotes) {
      if (!n.parentId || !nodeIds.has(n._id)) continue;
      const k = String(n.parentId);
      (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(n._id);
    }
    for (const ids of byParent.values()) pairwise(ids, 'sibling');
    // Tasks sharing the same list.
    const byList = new Map<string, string[]>();
    for (const t of liveTasks) {
      if (!t.parentNoteId || !nodeIds.has(t._id)) continue;
      const k = String(t.parentNoteId);
      (byList.get(k) ?? byList.set(k, []).get(k)!).push(t._id);
    }
    for (const ids of byList.values()) pairwise(ids, 'sibling');
  }

  if (config?.deriveSameDue) {
    // Tasks that fall on the same calendar day are loosely related.
    const byDay = new Map<string, string[]>();
    for (const t of liveTasks) {
      if (!t.dueDate || !nodeIds.has(t._id)) continue;
      const d = new Date(t.dueDate);
      if (!Number.isFinite(d.getTime())) continue;
      const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(t._id);
    }
    for (const ids of byDay.values()) pairwise(ids, 'same_due');
  }

  return { nodes, edges };
};

/** Human labels for the relation kinds (Swedish UI). */
export const RELATION_LABELS: Record<GraphRelation, string> = {
  in_project: 'i projektmapp',
  in_list: 'i lista',
  subtask: 'deluppgift av',
  sibling: 'samma mapp/lista',
  same_due: 'samma datum',
  linked: 'länkad',
};

/** Human labels for the node kinds (Swedish UI). */
export const NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  note: 'Anteckning',
  project: 'Projektmapp',
  task_list: 'Uppgiftslista',
  task: 'Uppgift',
};

export interface GraphNeighborhood {
  node: GraphNode;
  /** Edges where this node is the source (its parent/relation target). */
  outgoing: { edge: GraphEdge; node: GraphNode }[];
  /** Edges where this node is the target (its children/dependents). */
  incoming: { edge: GraphEdge; node: GraphNode }[];
}

/**
 * The neighbourhood of one node — what it connects to (outgoing) and what connects
 * to it (incoming) — so the explore view can show a node's relations clearly. Edges
 * to/from missing nodes are skipped.
 */
export const neighborsOf = (graph: GraphData, nodeId: string): GraphNeighborhood | null => {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return null;
  const outgoing: GraphNeighborhood['outgoing'] = [];
  const incoming: GraphNeighborhood['incoming'] = [];
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      const other = byId.get(edge.target);
      if (other) outgoing.push({ edge, node: other });
    } else if (edge.target === nodeId) {
      const other = byId.get(edge.source);
      if (other) incoming.push({ edge, node: other });
    }
  }
  return { node, outgoing, incoming };
};

/**
 * Filter an already-built graph by a free-text query over node labels. Keeps a node
 * if it matches, plus any node directly connected to a match (one hop) so relations
 * stay visible. Returns the original graph for an empty query. Pure.
 */
export const filterGraphByQuery = (graph: GraphData, query: string): GraphData => {
  const q = (query || '').trim().toLowerCase();
  if (!q) return graph;
  const direct = new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
  if (direct.size === 0) return { nodes: [], edges: [] };
  const keep = new Set(direct);
  for (const e of graph.edges) {
    if (direct.has(e.source)) keep.add(e.target);
    if (direct.has(e.target)) keep.add(e.source);
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
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
