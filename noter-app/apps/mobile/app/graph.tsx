/**
 * Graph explore/filter mode (mobile) — parity with the web GraphExplorer.
 *
 * Shows the knowledge graph (notes, project folders, task-lists, tasks) and the
 * relations between them. Filter by node kind + relation, search by label, tap a
 * node to see its relations, and open the entity. Pure data from @repo/shared
 * `buildGraph` over the already-decrypted in-memory store — nothing leaves device.
 */
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, ScrollView, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { Text, Chip, Searchbar, List, Divider, useTheme, Button, SegmentedButtons } from 'react-native-paper';
import Svg, { Line, Circle, G, Text as SvgText } from 'react-native-svg';
import {
  buildGraph, neighborsOf, filterGraphByQuery, layoutGraph, sortGraphNodes,
  RELATION_LABELS, NODE_KIND_LABELS, RELATION_COLORS, NODE_COLORS,
  type GraphNodeKind, type GraphRelation, type GraphConfig, type GraphSort,
} from '@repo/shared';
import { useStore } from '@/stores/useStore';

const ALL_KINDS: GraphNodeKind[] = ['project', 'task_list', 'note', 'task'];
const ALL_RELS: GraphRelation[] = ['in_project', 'in_list', 'subtask', 'linked', 'sibling', 'same_due'];
const KIND_ICON: Record<GraphNodeKind, string> = { project: 'folder', task_list: 'format-list-checks', note: 'note-text', task: 'checkbox-blank-outline' };

export default function GraphScreen() {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);

  const { width } = useWindowDimensions();
  const [kinds, setKinds] = useState<Set<GraphNodeKind>>(new Set(ALL_KINDS));
  const [rels, setRels] = useState<Set<GraphRelation>>(new Set(['in_project', 'in_list', 'subtask', 'linked'] as GraphRelation[]));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [sort, setSort] = useState<GraphSort>('connections');
  const [deriveSiblings, setDeriveSiblings] = useState(false);
  const [deriveSameDue, setDeriveSameDue] = useState(false);

  const config: GraphConfig = useMemo(() => ({ include: [...kinds], relations: [...rels], deriveSiblings, deriveSameDue }), [kinds, rels, deriveSiblings, deriveSameDue]);
  const graph = useMemo(() => buildGraph(notes as any, tasks as any, config), [notes, tasks, config]);
  const filtered = useMemo(() => filterGraphByQuery(graph, query), [graph, query]);
  const selected = useMemo(() => (selectedId ? neighborsOf(graph, selectedId) : null), [graph, selectedId]);
  const canvas = Math.max(280, width - 16);
  const layout = useMemo(() => layoutGraph(filtered, { width: canvas, height: canvas }), [filtered, canvas]);

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
      <Searchbar placeholder="Sök i grafen…" value={query} onChangeText={setQuery} style={{ margin: 8 }} testID="graph-search" />

      <SegmentedButtons
        value={view}
        onValueChange={(v) => setView(v as 'graph' | 'list')}
        density="small"
        style={{ marginHorizontal: 8, marginBottom: 4 }}
        buttons={[{ value: 'graph', label: 'Graf', icon: 'graph' }, { value: 'list', label: 'Lista', icon: 'format-list-bulleted' }]}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ paddingHorizontal: 8, gap: 6, alignItems: 'center' }}>
        {ALL_KINDS.map((k) => (
          <Chip key={k} selected={kinds.has(k)} onPress={() => toggle(kinds, k, setKinds)} compact icon={KIND_ICON[k]} testID={`graph-kind-${k}`}>
            {NODE_KIND_LABELS[k]}
          </Chip>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ paddingHorizontal: 8, gap: 6, alignItems: 'center' }}>
        {ALL_RELS.map((r) => (
          <Chip key={r} selected={rels.has(r)} onPress={() => toggle(rels, r, setRels)} compact testID={`graph-rel-${r}`}>
            {RELATION_LABELS[r]}
          </Chip>
        ))}
        <Chip compact selected={deriveSiblings} onPress={() => { setDeriveSiblings((v) => !v); setRels((s) => new Set(s).add('sibling')); }} testID="graph-derive-siblings">auto: samma mapp</Chip>
        <Chip compact selected={deriveSameDue} onPress={() => { setDeriveSameDue((v) => !v); setRels((s) => new Set(s).add('same_due')); }} testID="graph-derive-samedue">auto: samma datum</Chip>
      </ScrollView>

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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 8 }} maximumZoomScale={3} minimumZoomScale={1}>
          {filtered.nodes.length === 0 ? (
            <Text style={{ padding: 16, color: theme.colors.onSurfaceVariant }}>Inga noder matchar filtret.</Text>
          ) : (
            <Svg width={canvas} height={canvas} testID="graph-canvas">
              {layout.edges.map((e, i) => {
                const a = layout.nodes.find((n) => n.id === e.source);
                const b = layout.nodes.find((n) => n.id === e.target);
                if (!a || !b) return null;
                return <Line key={`e-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={RELATION_COLORS[e.rel] || '#cbd5e1'} strokeWidth={e.rel === 'sibling' || e.rel === 'same_due' ? 0.8 : 1.4} strokeOpacity={0.55} />;
              })}
              {layout.nodes.map((n) => (
                <G key={n.id} onPress={() => setSelectedId(n.id)}>
                  <Circle cx={n.x} cy={n.y} r={n.r} fill={NODE_COLORS[n.kind]} stroke={selectedId === n.id ? '#111827' : '#ffffff'} strokeWidth={selectedId === n.id ? 2.5 : 1} />
                  <SvgText x={n.x + n.r + 2} y={n.y + 3} fontSize={8} fill={theme.colors.onSurface}>{(n.label || '').slice(0, 16)}</SvgText>
                </G>
              ))}
            </Svg>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={sortGraphNodes(filtered, sort)}
          keyExtractor={(n) => n.id}
          testID="graph-node-list"
          ItemSeparatorComponent={Divider}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6, alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>Sortera:</Text>
              <Chip compact selected={sort === 'connections'} onPress={() => setSort('connections')}>Flest kopplingar</Chip>
              <Chip compact selected={sort === 'label'} onPress={() => setSort('label')}>Namn</Chip>
              <Chip compact selected={sort === 'kind'} onPress={() => setSort('kind')}>Typ</Chip>
            </ScrollView>
          }
          ListEmptyComponent={<Text style={{ padding: 16, color: theme.colors.onSurfaceVariant }}>Inga noder matchar filtret.</Text>}
          renderItem={({ item }) => (
            <List.Item
              title={item.label}
              description={item.kind === 'task_list' && item.stats.open != null ? `${NODE_KIND_LABELS[item.kind]} · ${item.stats.open} öppna / ${item.stats.completed ?? 0} klara` : item.stats.children ? `${NODE_KIND_LABELS[item.kind]} · ${item.stats.children} barn` : NODE_KIND_LABELS[item.kind]}
              left={(p) => <List.Icon {...p} icon={KIND_ICON[item.kind]} />}
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
  chipRow: { flexGrow: 0, maxHeight: 44 },
  detail: { margin: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  relLine: { fontSize: 13, marginTop: 3, textDecorationLine: 'underline' },
});
