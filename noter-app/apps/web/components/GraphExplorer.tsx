'use client';
/**
 * Graph explore/filter mode — a clear, dedicated view of the knowledge graph:
 * notes, project folders, task-lists and tasks as nodes, with the relations between
 * them (in_project / in_list / subtask). Filter by node kind + relation, search by
 * label, and click a node to see its relations and jump to the entity.
 *
 * Pure data comes from @repo/shared `buildGraph` (the same model the agent uses);
 * this component only renders + filters it. Everything is in-memory on already-
 * decrypted store data — nothing leaves the device.
 */
import React, { useMemo, useState } from 'react';
import {
  buildGraph, neighborsOf, filterGraphByQuery,
  RELATION_LABELS, NODE_KIND_LABELS,
  type GraphNodeKind, type GraphRelation, type GraphConfig,
} from '@repo/shared';
import { useStore } from '../stores/useStore';

const ALL_KINDS: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];
const ALL_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask'];

const KIND_ICON: Record<GraphNodeKind, string> = { project: '📁', task_list: '✓', note: '📝', task: '◻︎' };

export const GraphExplorer: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const selectNote = useStore((s) => s.selectNote);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [kinds, setKinds] = useState<Set<GraphNodeKind>>(new Set(ALL_KINDS));
  const [rels, setRels] = useState<Set<GraphRelation>>(new Set(ALL_RELS));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const config: GraphConfig = useMemo(() => ({ include: [...kinds], relations: [...rels] }), [kinds, rels]);
  const graph = useMemo(() => buildGraph(notes as any, tasks as any, config), [notes, tasks, config]);
  const filtered = useMemo(() => filterGraphByQuery(graph, query), [graph, query]);
  const selected = useMemo(() => (selectedId ? neighborsOf(graph, selectedId) : null), [graph, selectedId]);

  if (!isOpen) return null;

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    apply(next);
  };

  const openNode = (id: string, kind: GraphNodeKind) => {
    if (kind === 'task' || kind === 'task_list') setActiveTab('tasks');
    else setActiveTab('notes');
    if (kind !== 'task') selectNote(id);
    onClose();
  };

  const pill = (active: boolean) =>
    `px-2 py-0.5 rounded-full text-xs border ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Grafutforskaren">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="graph-explorer">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Grafutforskaren · {graph.nodes.length} noder, {graph.edges.length} relationer</h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Stäng">✕</button>
        </div>

        <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök i grafen…" data-testid="graph-search"
            className="w-full border rounded p-2 text-sm dark:bg-gray-800 dark:border-gray-700"
          />
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Typ:</span>
            {ALL_KINDS.map((k) => (
              <button key={k} className={pill(kinds.has(k))} onClick={() => toggle(kinds, k, setKinds)} data-testid={`graph-kind-${k}`}>
                {KIND_ICON[k]} {NODE_KIND_LABELS[k]}
              </button>
            ))}
            <span className="text-xs text-gray-500 mx-1">Relation:</span>
            {ALL_RELS.map((r) => (
              <button key={r} className={pill(rels.has(r))} onClick={() => toggle(rels, r, setRels)} data-testid={`graph-rel-${r}`}>
                {RELATION_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <ul className="w-1/2 overflow-y-auto border-r border-gray-200 dark:border-gray-700" data-testid="graph-node-list">
            {filtered.nodes.length === 0 && <li className="p-3 text-sm text-gray-500">Inga noder matchar filtret.</li>}
            {filtered.nodes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${selectedId === n.id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                >
                  <span className="mr-1">{KIND_ICON[n.kind]}</span>
                  {n.label}
                  <span className="text-xs text-gray-500 ml-1">
                    {n.kind === 'task_list' && n.stats.open != null ? `· ${n.stats.open} öppna / ${n.stats.completed ?? 0} klara` : n.stats.children ? `· ${n.stats.children} barn` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="w-1/2 overflow-y-auto p-3" data-testid="graph-detail">
            {!selected ? (
              <p className="text-sm text-gray-500">Välj en nod för att se dess relationer.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500">{NODE_KIND_LABELS[selected.node.kind]}</div>
                  <div className="font-semibold text-gray-800 dark:text-gray-100">{KIND_ICON[selected.node.kind]} {selected.node.label}</div>
                  <button onClick={() => openNode(selected.node.id, selected.node.kind)} className="mt-1 text-xs text-blue-600 dark:text-blue-400" data-testid="graph-open-node">
                    Öppna →
                  </button>
                </div>
                {selected.outgoing.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Tillhör</div>
                    {selected.outgoing.map((o, i) => (
                      <button key={`o-${i}`} onClick={() => setSelectedId(o.node.id)} className="block text-sm text-left hover:underline">
                        {RELATION_LABELS[o.edge.rel]}: {KIND_ICON[o.node.kind]} {o.node.label}
                      </button>
                    ))}
                  </div>
                )}
                {selected.incoming.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Innehåller ({selected.incoming.length})</div>
                    {selected.incoming.map((inc, i) => (
                      <button key={`i-${i}`} onClick={() => setSelectedId(inc.node.id)} className="block text-sm text-left hover:underline">
                        {KIND_ICON[inc.node.kind]} {inc.node.label} <span className="text-xs text-gray-500">({RELATION_LABELS[inc.edge.rel]})</span>
                      </button>
                    ))}
                  </div>
                )}
                {selected.outgoing.length === 0 && selected.incoming.length === 0 && (
                  <p className="text-sm text-gray-500">Inga relationer.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GraphExplorer;
