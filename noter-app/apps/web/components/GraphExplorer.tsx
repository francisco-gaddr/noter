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
  buildGraph, neighborsOf, filterGraphByQuery, layoutGraph,
  RELATION_LABELS, NODE_KIND_LABELS, RELATION_COLORS, NODE_COLORS,
  type GraphNodeKind, type GraphRelation, type GraphConfig,
} from '@repo/shared';
import { useStore } from '../stores/useStore';

const ALL_KINDS: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];
const ALL_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask', 'linked', 'sibling', 'same_due'];

const KIND_ICON: Record<GraphNodeKind, string> = { project: '📁', task_list: '✓', note: '📝', task: '◻︎' };

export const GraphExplorer: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const selectNote = useStore((s) => s.selectNote);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [kinds, setKinds] = useState<Set<GraphNodeKind>>(new Set(ALL_KINDS));
  const [rels, setRels] = useState<Set<GraphRelation>>(new Set(['in_project', 'in_list', 'subtask', 'linked'] as GraphRelation[]));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [deriveSiblings, setDeriveSiblings] = useState(false);
  const [deriveSameDue, setDeriveSameDue] = useState(false);

  const config: GraphConfig = useMemo(() => ({ include: [...kinds], relations: [...rels], deriveSiblings, deriveSameDue }), [kinds, rels, deriveSiblings, deriveSameDue]);
  const graph = useMemo(() => buildGraph(notes as any, tasks as any, config), [notes, tasks, config]);
  const filtered = useMemo(() => filterGraphByQuery(graph, query), [graph, query]);
  const selected = useMemo(() => (selectedId ? neighborsOf(graph, selectedId) : null), [graph, selectedId]);
  const layout = useMemo(() => layoutGraph(filtered, { width: 1100, height: 850 }), [filtered]);

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
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-6xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="graph-explorer">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Grafutforskaren · {graph.nodes.length} noder, {graph.edges.length} relationer</h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600 text-xs">
              <button onClick={() => setView('graph')} className={`px-2 py-1 ${view === 'graph' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`} data-testid="graph-view-graph">Graf</button>
              <button onClick={() => setView('list')} className={`px-2 py-1 ${view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`} data-testid="graph-view-list">Lista</button>
            </div>
            <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Stäng">✕</button>
          </div>
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
            <span className="text-xs text-gray-500 mx-1">Auto:</span>
            <button className={pill(deriveSiblings)} onClick={() => { setDeriveSiblings((v) => !v); setRels((s) => new Set(s).add('sibling')); }} data-testid="graph-derive-siblings">samma mapp/lista</button>
            <button className={pill(deriveSameDue)} onClick={() => { setDeriveSameDue((v) => !v); setRels((s) => new Set(s).add('same_due')); }} data-testid="graph-derive-samedue">samma datum</button>
          </div>
        </div>

        {view === 'graph' && (
          <div className="relative flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950" data-testid="graph-canvas">
            {filtered.nodes.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Inga noder matchar filtret.</div>}
            {selected && (
              <div className="absolute top-2 right-2 w-64 max-h-[80%] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-10" data-testid="graph-detail-overlay">
                <div className="text-xs uppercase tracking-wider text-gray-500">{NODE_KIND_LABELS[selected.node.kind]}</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{KIND_ICON[selected.node.kind]} {selected.node.label}</div>
                <button onClick={() => openNode(selected.node.id, selected.node.kind)} className="mt-1 text-xs text-blue-600 dark:text-blue-400">Öppna →</button>
                {[...selected.outgoing, ...selected.incoming].length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="font-semibold text-gray-600 dark:text-gray-300 mb-1">Relationer</div>
                    {selected.outgoing.map((o, i) => (
                      <button key={`o-${i}`} onClick={() => setSelectedId(o.node.id)} className="block text-left hover:underline">{RELATION_LABELS[o.edge.rel]}: {o.node.label}</button>
                    ))}
                    {selected.incoming.map((inc, i) => (
                      <button key={`i-${i}`} onClick={() => setSelectedId(inc.node.id)} className="block text-left hover:underline">{inc.node.label} ({RELATION_LABELS[inc.edge.rel]})</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              {layout.edges.map((e, i) => {
                const a = layout.nodes.find((n) => n.id === e.source);
                const b = layout.nodes.find((n) => n.id === e.target);
                if (!a || !b) return null;
                return <line key={`e-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={RELATION_COLORS[e.rel] || '#cbd5e1'} strokeWidth={e.rel === 'sibling' || e.rel === 'same_due' ? 0.8 : 1.4} strokeOpacity={0.55} strokeDasharray={e.rel === 'same_due' || e.rel === 'sibling' ? '4 3' : undefined} />;
              })}
              {layout.nodes.map((n) => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => setSelectedId(n.id)} style={{ cursor: 'pointer' }}>
                  <circle r={n.r} fill={NODE_COLORS[n.kind]} stroke={selectedId === n.id ? '#111827' : '#fff'} strokeWidth={selectedId === n.id ? 2.5 : 1} />
                  <text x={n.r + 3} y={4} fontSize={11} className="fill-gray-700 dark:fill-gray-200">{(n.label || '').slice(0, 22)}</text>
                </g>
              ))}
            </svg>
          </div>
        )}

        <div className={`${view === 'graph' ? 'hidden' : 'flex'} flex-1 overflow-hidden`}>
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
