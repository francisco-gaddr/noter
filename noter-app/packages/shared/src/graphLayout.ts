/**
 * Deterministic graph layout — turns GraphData into positioned nodes for a visual
 * graph, with no external library and no randomness (so it's identical every render
 * and across web SVG + mobile react-native-svg).
 *
 * Layout: concentric rings grouped by kind (projects innermost → lists → notes →
 * tasks outermost), nodes evenly spaced by index on their ring. This reads as tidy
 * "area groups" (folders/lists in the middle, their items around them) and keeps edges
 * mostly short. Good enough to be pretty + interactive; a force/cytoscape layout is an
 * optional upgrade (ADR 0006 Phase 2).
 */
import type { GraphData, GraphNode, GraphNodeKind, GraphEdge } from './graphModel';

export interface PositionedNode extends GraphNode { x: number; y: number; r: number }
export interface GraphLayout {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

// Inner→outer ring order; each kind gets its own ring so groups read clearly.
const RING_ORDER: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];

export const layoutGraph = (graph: GraphData, opts: { width?: number; height?: number } = {}): GraphLayout => {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 1000;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2 - 48;

  const byKind = new Map<GraphNodeKind, GraphNode[]>();
  for (const n of graph.nodes) {
    const arr = byKind.get(n.kind) ?? byKind.set(n.kind, []).get(n.kind)!;
    arr.push(n);
  }
  // Rings that actually have nodes, inner→outer.
  const activeRings = RING_ORDER.filter((k) => (byKind.get(k)?.length ?? 0) > 0);
  const ringCount = Math.max(1, activeRings.length);

  const nodes: PositionedNode[] = [];
  activeRings.forEach((kind, ringIdx) => {
    const group = byKind.get(kind)!;
    // Ring radius: spread rings from center outward; a lone ring sits mid-radius.
    const radius = ringCount === 1 ? maxR * 0.6 : maxR * (0.28 + 0.72 * (ringIdx / (ringCount - 1)));
    const count = group.length;
    group.forEach((node, i) => {
      // Even angular spacing; offset each ring slightly so nodes don't line up radially.
      const angle = (i / count) * Math.PI * 2 + ringIdx * 0.4;
      const r = node.kind === 'project' ? 16 : node.kind === 'task_list' ? 14 : node.kind === 'task' ? 9 : 11;
      nodes.push({
        ...node,
        x: cx + Math.cos(angle) * (count === 1 && ringCount === 1 ? 0 : radius),
        y: cy + Math.sin(angle) * (count === 1 && ringCount === 1 ? 0 : radius),
        r,
      });
    });
  });

  return { nodes, edges: graph.edges, width, height };
};

/** Stable colour per relation kind for edges (hex, theme-agnostic). */
export const RELATION_COLORS: Record<string, string> = {
  in_project: '#6366f1', // indigo
  in_list: '#0ea5e9', // sky
  subtask: '#14b8a6', // teal
  sibling: '#a3a3a3', // grey
  same_due: '#f59e0b', // amber
  linked: '#ec4899', // pink
};

/** Stable colour per node kind (hex). */
export const NODE_COLORS: Record<GraphNodeKind, string> = {
  project: '#6366f1',
  task_list: '#0ea5e9',
  note: '#64748b',
  task: '#14b8a6',
};
