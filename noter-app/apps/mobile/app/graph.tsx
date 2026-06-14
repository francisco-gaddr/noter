/**
 * Graph explore/filter mode (mobile) — parity with the web GraphExplorer.
 *
 * Shows the knowledge graph (notes, project folders, task-lists, tasks) and the
 * relations between them. Filter by node kind + relation, search by label, tap a
 * node to see its relations, and open the entity. Pure data from @repo/shared
 * `buildGraph` over the already-decrypted in-memory store — nothing leaves device.
 *
 * The graph canvas is fully interactive: pinch to zoom, drag to pan, two-finger
 * rotate, double-tap to reset. Gestures run on the UI thread (reanimated) so the
 * SVG stays smooth; a single tap still selects a node.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, ScrollView, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { Text, Chip, Searchbar, List, Divider, useTheme, Button, Switch } from 'react-native-paper';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Svg, { Line, Circle, G, Polygon, Text as SvgText } from 'react-native-svg';
import {
  buildGraph, neighborsOf, filterGraphByQuery, layoutGraph, sortGraphNodes, edgeGeometry,
  fulltextSearch, hybridSearch, buildSecurityNoteMap, isReadableWithLocks,
  RELATION_LABELS, NODE_KIND_LABELS, RELATION_COLORS, NODE_COLORS,
  type GraphNodeKind, type GraphRelation, type GraphConfig, type GraphSort,
} from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { semanticSearch, getIndexInfo } from '@/services/ai/embeddingsService';

const ALL_KINDS: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];
const ALL_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask', 'linked', 'sibling', 'same_due'];
const KIND_ICON: Record<GraphNodeKind, string> = { project: 'folder', task_list: 'format-list-checks', note: 'note-text', task: 'checkbox-blank-outline' };

const NODE_SCALES: { key: string; label: string; mult: number }[] = [
  { key: 'small', label: 'Liten', mult: 0.8 },
  { key: 'medium', label: 'Mellan', mult: 1 },
  { key: 'large', label: 'Stor', mult: 1.35 },
];
const LABEL_LENS: { key: string; label: string; len: number }[] = [
  { key: 'short', label: 'Kort', len: 12 },
  { key: 'normal', label: 'Normal', len: 18 },
  { key: 'long', label: 'Lång', len: 30 },
];

export default function GraphScreen() {
  const theme = useTheme();
  const allNotes = useStore((s) => s.notes);
  const allTasks = useStore((s) => s.tasks);
  const unlockedProtectedNoteIds = useStore((s) => s.unlockedProtectedNoteIds);

  // SECURITY: never put locked-folder notes/tasks into the graph (it would reveal their
  // titles/relations). Filter to readable by the current unlock state before buildGraph.
  const { notes, tasks } = useMemo(() => {
    const securityMap = buildSecurityNoteMap(allNotes as any);
    const unlockedSet = new Set(unlockedProtectedNoteIds || []);
    const rNotes = (allNotes || []).filter((n: any) => isReadableWithLocks(n, securityMap as any, unlockedSet));
    const rTasks = (allTasks || []).filter((t: any) => !t.parentNoteId || isReadableWithLocks(securityMap.get(String(t.parentNoteId)) as any, securityMap as any, unlockedSet));
    return { notes: rNotes, tasks: rTasks };
  }, [allNotes, allTasks, unlockedProtectedNoteIds]);

  const { width } = useWindowDimensions();
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
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  // Two independent collapsible panels keep the toolbar clean: filters (type/relation)
  // and the richer graph settings (labels, node size, auto-relations, reset). Both
  // hidden by default; their active values still apply to the live graph.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  // Graph appearance settings (live).
  const [showLabels, setShowLabels] = useState(true);
  const [nodeScale, setNodeScale] = useState(1);
  const [labelLen, setLabelLen] = useState(18);

  const config: GraphConfig = useMemo(() => ({ include: [...kinds], relations: [...rels], deriveSiblings, deriveSameDue }), [kinds, rels, deriveSiblings, deriveSameDue]);
  const graph = useMemo(() => buildGraph(notes as any, tasks as any, config), [notes, tasks, config]);

  useEffect(() => { getIndexInfo().then((i) => setSemanticEnabled(i.enabled && i.total > 0)).catch(() => {}); }, [semantic]);

  // Hybrid (fulltext + vector, fused by RRF), debounced. Degrades to pure fulltext when
  // the vector rung is empty/disabled. Matched ids drive the same graph filter as text.
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
      const ns = graph.nodes.filter((n) => semanticIds.has(n.id));
      const ids = new Set(ns.map((n) => n.id));
      return { nodes: ns, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    }
    return filterGraphByQuery(graph, query);
  }, [graph, query, semantic, semanticIds]);
  const selected = useMemo(() => (selectedId ? neighborsOf(graph, selectedId) : null), [graph, selectedId]);
  const canvas = Math.max(280, width - 16);
  const layout = useMemo(() => layoutGraph(filtered, { width: canvas, height: canvas }), [filtered, canvas]);
  const nodePos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; r: number }>();
    layout.nodes.forEach((n) => m.set(n.id, { x: n.x, y: n.y, r: n.r }));
    return m;
  }, [layout]);

  // ---- Interactive canvas transform (pan / pinch / rotate) ----
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const rot = useSharedValue(0);
  const savedRot = useSharedValue(0);

  const resetView = () => {
    'worklet';
    scale.value = withTiming(1); savedScale.value = 1;
    tx.value = withTiming(0); savedTx.value = 0;
    ty.value = withTiming(0); savedTy.value = 0;
    rot.value = withTiming(0); savedRot.value = 0;
  };

  const panG = Gesture.Pan()
    .minDistance(8) // quick taps fall through to the SVG node onPress
    .averageTouches(true)
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });
  const pinchG = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.min(6, Math.max(0.4, savedScale.value * e.scale)); })
    .onEnd(() => { savedScale.value = scale.value; });
  const rotateG = Gesture.Rotation()
    .onUpdate((e) => { rot.value = savedRot.value + e.rotation; })
    .onEnd(() => { savedRot.value = rot.value; });
  const doubleTapG = Gesture.Tap().numberOfTaps(2).onEnd(() => { resetView(); });
  const composedGesture = Gesture.Simultaneous(panG, pinchG, rotateG, doubleTapG);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
      { rotateZ: `${rot.value}rad` },
    ],
  }));

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    apply(next);
  };

  const openNode = (id: string, kind: GraphNodeKind) => {
    router.push(kind === 'task' ? `/task/${id}` : `/note/${id}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: 'Utforska grafen' }} />
      <Searchbar placeholder={semantic ? 'Semantisk sök i grafen…' : 'Sök i grafen…'} value={query} onChangeText={setQuery} style={{ margin: 8, marginBottom: 4 }} testID="graph-search" />

      {/* Single toolbar row: semantic + filter + settings toggles AND the graph/list switch. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2, gap: 6 }}
      >
        <Chip compact selected={semantic} icon={semanticBusy ? 'timer-sand' : 'brain'} onPress={() => setSemantic((v) => !v)} testID="graph-semantic-toggle">Semantisk</Chip>
        <Chip compact selected={filtersVisible} icon={filtersVisible ? 'filter-minus' : 'filter-variant'} onPress={() => setFiltersVisible((v) => !v)} testID="graph-filters-toggle">Filter</Chip>
        <Chip compact selected={settingsVisible} icon="cog" onPress={() => setSettingsVisible((v) => !v)} testID="graph-settings-toggle">Inställningar</Chip>
        <View style={{ width: 1, height: 22, backgroundColor: theme.colors.outlineVariant, marginHorizontal: 2 }} />
        <Chip compact selected={view === 'graph'} icon="graph" onPress={() => setView('graph')} testID="graph-view-graph">Graf</Chip>
        <Chip compact selected={view === 'list'} icon="format-list-bulleted" onPress={() => setView('list')} testID="graph-view-list">Lista</Chip>
      </ScrollView>

      {semantic && !semanticEnabled && (
        <Text style={{ paddingHorizontal: 10, paddingTop: 4, fontSize: 11, color: theme.colors.onSurfaceVariant }}>
          Aktivera och indexera under Inställningar → Semantisk sök. Tills dess används endast textsökning.
        </Text>
      )}

      {filtersVisible && (<>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {ALL_KINDS.map((k) => (
            <Chip key={k} selected={kinds.has(k)} onPress={() => toggle(kinds, k, setKinds)} icon={KIND_ICON[k]} style={styles.filterChip} testID={`graph-kind-${k}`}>
              {NODE_KIND_LABELS[k]}
            </Chip>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {ALL_RELS.map((r) => (
            <Chip key={r} selected={rels.has(r)} onPress={() => toggle(rels, r, setRels)} style={styles.filterChip} testID={`graph-rel-${r}`}>
              {RELATION_LABELS[r]}
            </Chip>
          ))}
        </ScrollView>
      </>)}

      {settingsVisible && (
        <View style={[styles.settingsPanel, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.elevation?.level1 || theme.colors.surface }]}>
          <View style={styles.settingsRow}>
            <Text style={{ color: theme.colors.onSurface }}>Visa etiketter</Text>
            <Switch value={showLabels} onValueChange={setShowLabels} testID="graph-setting-labels" />
          </View>

          <Text style={styles.settingsLabel}>Nodstorlek</Text>
          <View style={styles.settingsChipRow}>
            {NODE_SCALES.map((s) => (
              <Chip key={s.key} compact selected={nodeScale === s.mult} onPress={() => setNodeScale(s.mult)} style={styles.filterChip}>{s.label}</Chip>
            ))}
          </View>

          <Text style={styles.settingsLabel}>Etikettlängd</Text>
          <View style={styles.settingsChipRow}>
            {LABEL_LENS.map((l) => (
              <Chip key={l.key} compact selected={labelLen === l.len} onPress={() => setLabelLen(l.len)} style={styles.filterChip}>{l.label}</Chip>
            ))}
          </View>

          <Text style={styles.settingsLabel}>Härledda relationer</Text>
          <View style={styles.settingsChipRow}>
            <Chip compact selected={deriveSiblings} icon={deriveSiblings ? 'check' : 'plus'} onPress={() => { setDeriveSiblings((v) => !v); setRels((s) => new Set(s).add('sibling')); }} style={styles.filterChip} testID="graph-derive-siblings">Samma mapp</Chip>
            <Chip compact selected={deriveSameDue} icon={deriveSameDue ? 'check' : 'plus'} onPress={() => { setDeriveSameDue((v) => !v); setRels((s) => new Set(s).add('same_due')); }} style={styles.filterChip} testID="graph-derive-samedue">Samma datum</Chip>
          </View>

          {view === 'graph' && (
            <Button mode="outlined" compact icon="restore" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => resetView()} testID="graph-reset-view">
              Återställ vy (zoom/rotation)
            </Button>
          )}
          <Text style={{ marginTop: 8, fontSize: 11, color: theme.colors.onSurfaceVariant }}>
            Tips: nyp för att zooma, dra för att panorera, vrid med två fingrar, dubbeltryck för att återställa.
          </Text>
        </View>
      )}

      <Text style={{ paddingHorizontal: 12, paddingVertical: 4, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
        {graph.nodes.length} noder · {graph.edges.length} relationer
      </Text>

      {selected ? (
        <View style={[styles.detail, { borderColor: theme.colors.outlineVariant }]}>
          <Text variant="titleSmall">{selected.node.label}</Text>
          <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>{NODE_KIND_LABELS[selected.node.kind]}</Text>
          {selected.outgoing.map((o, i) => (
            <Text key={`o-${i}`} style={styles.relLine} onPress={() => setSelectedId(o.node.id)}>↑ {RELATION_LABELS[o.edge.rel]}: {o.node.label}</Text>
          ))}
          {selected.incoming.map((inc, i) => (
            <Text key={`i-${i}`} style={styles.relLine} onPress={() => setSelectedId(inc.node.id)}>↓ {inc.node.label} ({RELATION_LABELS[inc.edge.rel]})</Text>
          ))}
          {selected.outgoing.length === 0 && selected.incoming.length === 0 && (
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>Inga relationer.</Text>
          )}
          <Button mode="contained-tonal" compact style={{ marginTop: 6, alignSelf: 'flex-start' }} onPress={() => openNode(selected.node.id, selected.node.kind)} testID="graph-open-node">
            Öppna
          </Button>
        </View>
      ) : null}

      {view === 'graph' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxHeight: 28 }} contentContainerStyle={{ paddingHorizontal: 10, gap: 10, alignItems: 'center' }}>
            {ALL_RELS.filter((r) => rels.has(r)).map((r) => (
              <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: RELATION_COLORS[r] || '#cbd5e1' }} />
                <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{RELATION_LABELS[r]}</Text>
              </View>
            ))}
          </ScrollView>
          {filtered.nodes.length === 0 ? (
            <Text style={{ padding: 16, color: theme.colors.onSurfaceVariant }}>Inga noder matchar filtret.</Text>
          ) : (
            <View style={styles.canvasViewport}>
              <GestureDetector gesture={composedGesture}>
                <Animated.View style={[{ width: canvas, height: canvas }, canvasStyle]}>
                  <Svg width={canvas} height={canvas} testID="graph-canvas">
                    {layout.edges.map((e, i) => {
                      const a = nodePos.get(e.source);
                      const b = nodePos.get(e.target);
                      if (!a || !b) return null;
                      const geo = edgeGeometry(a.x, a.y, a.r * nodeScale, b.x, b.y, b.r * nodeScale, 8);
                      if (!geo) return null;
                      const color = RELATION_COLORS[e.rel] || '#94a3b8';
                      const dashed = e.rel === 'sibling' || e.rel === 'same_due';
                      return (
                        <G key={`e-${i}`}>
                          <Line x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2} stroke={color} strokeWidth={dashed ? 1.2 : 2} strokeOpacity={0.85} strokeDasharray={dashed ? '4 3' : undefined} />
                          <Polygon points={geo.arrow} fill={color} fillOpacity={0.9} />
                        </G>
                      );
                    })}
                    {layout.nodes.map((n) => {
                      const r = n.r * nodeScale;
                      return (
                        <G key={n.id} onPress={() => setSelectedId(n.id)}>
                          <Circle cx={n.x} cy={n.y} r={r + (selectedId === n.id ? 2 : 0)} fill={NODE_COLORS[n.kind]} stroke={selectedId === n.id ? theme.colors.onSurface : '#ffffff'} strokeWidth={selectedId === n.id ? 3 : 1.5} />
                          {showLabels && (
                            <SvgText x={n.x} y={n.y + r + 11} fontSize={9} fontWeight={selectedId === n.id ? '700' : '400'} fill={theme.colors.onSurface} textAnchor="middle">{(n.label || '').slice(0, labelLen)}</SvgText>
                          )}
                        </G>
                      );
                    })}
                  </Svg>
                </Animated.View>
              </GestureDetector>
            </View>
          )}
        </>
      ) : (
        <FlatList
          data={sortGraphNodes(filtered, sort)}
          keyExtractor={(n) => n.id}
          testID="graph-node-list"
          ItemSeparatorComponent={Divider}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
              <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, alignSelf: 'center' }}>Sortera:</Text>
              <Chip selected={sort === 'connections'} onPress={() => setSort('connections')} style={styles.filterChip}>Flest kopplingar</Chip>
              <Chip selected={sort === 'label'} onPress={() => setSort('label')} style={styles.filterChip}>Namn</Chip>
              <Chip selected={sort === 'kind'} onPress={() => setSort('kind')} style={styles.filterChip}>Typ</Chip>
            </ScrollView>
          }
          ListEmptyComponent={<Text style={{ padding: 16, color: theme.colors.onSurfaceVariant }}>Inga noder matchar filtret.</Text>}
          renderItem={({ item }) => (
            <List.Item
              title={item.label}
              titleNumberOfLines={2}
              description={item.kind === 'task_list' && item.stats.open != null ? `${NODE_KIND_LABELS[item.kind]} · ${item.stats.open} öppna / ${item.stats.completed ?? 0} klara` : item.stats.children ? `${NODE_KIND_LABELS[item.kind]} · ${item.stats.children} barn` : NODE_KIND_LABELS[item.kind]}
              left={(p) => <List.Icon {...p} icon={KIND_ICON[item.kind]} />}
              rippleColor="rgba(33, 150, 243, 0.22)"
              onPress={() => setSelectedId(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Filter/sort chip rows: generous height + vertical padding so chip labels are
  // never vertically clipped (the old maxHeight:44 squashed them in list view).
  chipRow: { flexGrow: 0 },
  chipRowContent: { paddingHorizontal: 8, paddingVertical: 8, gap: 8, alignItems: 'center' },
  filterChip: { marginVertical: 2 },
  settingsPanel: { marginHorizontal: 8, marginTop: 2, marginBottom: 2, padding: 12, borderRadius: 10, borderWidth: 1 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsLabel: { marginTop: 10, marginBottom: 4, fontSize: 12, fontWeight: '600' },
  settingsChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  canvasViewport: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  detail: { margin: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  relLine: { fontSize: 13, marginTop: 3, textDecorationLine: 'underline' },
});
