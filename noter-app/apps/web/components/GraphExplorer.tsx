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
import React, { useEffect, useMemo, useState } from 'react';
import {
  buildGraph, neighborsOf, filterGraphByQuery, layoutGraph, sortGraphNodes, edgeGeometry,
  fulltextSearch, hybridSearch, buildSecurityNoteMap, isReadableWithLocks,
  RELATION_LABELS, NODE_KIND_LABELS, RELATION_COLORS, NODE_COLORS,
  type GraphNodeKind, type GraphRelation, type GraphConfig, type GraphSort,
} from '@repo/shared';
import { useStore } from '../stores/useStore';
import { semanticSearch, getIndexInfo } from '../services/ai/embeddingsService';

const ALL_KINDS: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];
const ALL_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask', 'linked', 'sibling', 'same_due'];

const KIND_ICON: Record<GraphNodeKind, string> = { project: '📁', task_list: '✓', note: '📝', task: '◻︎' };

export const GraphExplorer: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const allNotes = useStore((s) => s.notes);
  const allTasks = useStore((s) => s.tasks);
  const unlockedProtectedNoteIds = useStore((s) => s.unlockedProtectedNoteIds);
  const selectNote = useStore((s) => s.selectNote);
  const setActiveTab = useStore((s) => s.setActiveTab);

  // SECURITY: never graph locked-folder notes/tasks (would reveal titles/relations).
  const { notes, tasks } = useMemo(() => {
    const securityMap = buildSecurityNoteMap(allNotes as any);
    const unlockedSet = new Set(unlockedProtectedNoteIds || []);
    const rNotes = (allNotes || []).filter((n: any) => isReadableWithLocks(n, securityMap as any, unlockedSet));
    const rTasks = (allTasks || []).filter((t: any) => !t.parentNoteId || isReadableWithLocks(securityMap.get(String(t.parentNoteId)) as any, securityMap as any, unlockedSet));
    return { notes: rNotes, tasks: rTasks };
  }, [allNotes, allTasks, unlockedProtectedNoteIds]);

  const [kinds, setKinds] = useState<Set<GraphNodeKind>>(new Set(ALL_KINDS));
  const [rels, setRels] = useState<Set<GraphRelation>>(new Set(['in_project', 'in_list', 'subtask', 'linked'] as GraphRelation[]));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [sort, setSort] = useState<GraphSort>('connections');
  const [deriveSiblings, setDeriveSiblings] = useState(false);
  const [deriveSameDue, setDeriveSameDue] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [semanticIds, setSemanticIds] = useState<Set<string> | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const semanticInfo = useMemo(() => (isOpen ? getIndexInfo() : { total: 0, model: '', enabled: false }), [isOpen, semantic]);

  const config: GraphConfig = useMemo(() => ({ include: [...kinds], relations: [...rels], deriveSiblings, deriveSameDue }), [kinds, rels, deriveSiblings, deriveSameDue]);
  const graph = useMemo(() => buildGraph(notes as any, tasks as any, config), [notes, tasks, config]);

  // Hybrid (fulltext + vector, fused by RRF) — debounced so we embed the query once the
  // user pauses, not on every keystroke. Degrades to pure fulltext when the vector rung
  // is empty/disabled. Matched ids drive the same graph filter as the text search.
  useEffect(() => {
    if (!semantic || !query.trim()) { setSemanticIds(null); setSemanticBusy(false); return; }
    let cancelled = false;
    setSemanticBusy(true);
    const handle = setTimeout(() => {
      (async () => {
        const ft = fulltextSearch(notes as any, tasks as any, query, 60);
        const vec = await semanticSearch(query, 60);
        const fused = hybridSearch(ft, vec, 60);
        if (!cancelled) { setSemanticIds(new Set(fused.map((h) => h.id))); setSemanticBusy(false); }
      })().catch(() => { if (!cancelled) { setSemanticIds(null); setSemanticBusy(false); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [semantic, query, notes, tasks]);

  const filtered = useMemo(() => {
    if (semantic && query.trim() && semanticIds) {
      const nodes = graph.nodes.filter((n) => semanticIds.has(n.id));
      const ids = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      return { nodes, edges };
    }
    return filterGraphByQuery(graph, query);
  }, [graph, query, semantic, semanticIds]);
  const selected = useMemo(() => (selectedId ? neighborsOf(graph, selectedId) : null), [graph, selectedId]);
  const layout = useMemo(() => layoutGraph(filtered, { width: 1100, height: 850 }), [filtered]);
  const nodePos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; r: number }>();
    layout.nodes.forEach((n) => m.set(n.id, { x: n.x, y: n.y, r: n.r }));
    return m;
  }, [layout]);

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
          <div className="flex items-center gap-2">
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={semantic ? 'Semantisk sök i grafen…' : 'Sök i grafen…'} data-testid="graph-search"
              className="flex-1 border rounded p-2 text-sm dark:bg-gray-800 dark:border-gray-700"
            />
            <button
              onClick={() => setSemantic((v) => !v)}
              className={pill(semantic)}
              data-testid="graph-semantic-toggle"
              title={semanticInfo.enabled
                ? `Semantisk sök (RRF-fusion av text + ${semanticInfo.total} indexerade vektorer, modell ${semanticInfo.model})`
                : 'Semantisk sök är avstängd – aktivera och indexera under Inställningar → Semantisk sök'}
            >
              {semanticBusy ? '⏳' : '🧠'} Semantisk
            </button>
          </div>
          {semantic && !semanticInfo.enabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Semantisk sök är avstängd. Aktivera och indexera under Inställningar → Semantisk sök. Tills dess används endast textsökning.</p>
          )}
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
            {filtered.nodes.length > 0 && (
              <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/85 dark:bg-gray-900/85 px-2 py-1 text-[10px] shadow">
                {ALL_RELS.filter((r) => rels.has(r)).map((r) => (
                  <span key={r} className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                    <span className="inline-block w-3 h-[3px] rounded" style={{ backgroundColor: RELATION_COLORS[r] || '#94a3b8' }} />
                    {RELATION_LABELS[r]}
                  </span>
                ))}
              </div>
            )}
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
                const a = nodePos.get(e.source);
                const b = nodePos.get(e.target);
                if (!a || !b) return null;
                const geo = edgeGeometry(a.x, a.y, a.r, b.x, b.y, b.r, 9);
                if (!geo) return null;
                const color = RELATION_COLORS[e.rel] || '#94a3b8';
                const dashed = e.rel === 'sibling' || e.rel === 'same_due';
                return (
                  <g key={`e-${i}`}>
                    <line x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2} stroke={color} strokeWidth={dashed ? 1.2 : 2} strokeOpacity={0.85} strokeDasharray={dashed ? '5 4' : undefined} />
                    <polygon points={geo.arrow} fill={color} fillOpacity={0.9} />
                  </g>
                );
              })}
              {layout.nodes.map((n) => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => setSelectedId(n.id)} style={{ cursor: 'pointer' }}>
                  <circle r={n.r + (selectedId === n.id ? 2 : 0)} fill={NODE_COLORS[n.kind]} stroke={selectedId === n.id ? '#111827' : '#fff'} strokeWidth={selectedId === n.id ? 3 : 1.5} />
                  <text x={0} y={n.r + 13} textAnchor="middle" fontSize={11} fontWeight={selectedId === n.id ? 700 : 400} className="fill-gray-700 dark:fill-gray-200">{(n.label || '').slice(0, 22)}</text>
                </g>
              ))}
            </svg>
          </div>
        )}

        <div className={`${view === 'graph' ? 'hidden' : 'flex flex-col'} flex-1 overflow-hidden`}>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-xs">
            <span className="text-gray-500">Sortera:</span>
            <select className="border rounded p-1 text-xs dark:bg-gray-800 dark:border-gray-700" value={sort} onChange={(e) => setSort(e.target.value as GraphSort)} data-testid="graph-sort">
              <option value="connections">Flest kopplingar</option>
              <option value="label">Namn (A–Ö)</option>
              <option value="kind">Typ</option>
            </select>
          </div>
          <div className="flex flex-1 overflow-hidden">
          <ul className="w-1/2 overflow-y-auto border-r border-gray-200 dark:border-gray-700" data-testid="graph-node-list">
            {filtered.nodes.length === 0 && <li className="p-3 text-sm text-gray-500">Inga noder matchar filtret.</li>}
            {sortGraphNodes(filtered, sort).map((n) => (
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
    </div>
  );
};

export default GraphExplorer;
