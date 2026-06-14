/**
 * Admin cleanup (mobile) — bulk-remove empty notes, titleless tasks and completed
 * tasks. Uses the shared cleanupCandidates selector (identical categories to web).
 * Lists are scrollable so nothing is hidden.
 */
import React, { useMemo, useState } from 'react';
import { View, ScrollView, Alert, StyleSheet } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { cleanupCandidates } from '@repo/shared';
import { useStore } from '@/stores/useStore';

const Category: React.FC<{ title: string; items: { _id: string; title?: string }[]; busy: boolean; onClear: () => void }> = ({ title, items, busy, onClear }) => {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={[styles.cat, { borderColor: theme.colors.outlineVariant }]}>
      <View style={styles.rowBetween}>
        <Text style={{ fontWeight: '600' }}>{title} ({items.length})</Text>
        <Button mode="contained-tonal" compact disabled={busy} onPress={onClear} textColor={theme.colors.error}>Rensa {items.length}</Button>
      </View>
      <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
        {items.map((i) => (
          <Text key={i._id} style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
            • {i.title?.trim() || '(tomt)'}  {i._id.slice(0, 8)}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
};

export const AdminCleanup: React.FC = () => {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const deleteNote = useStore((s) => s.deleteNote);
  const deleteTask = useStore((s) => s.deleteTask);
  const [busy, setBusy] = useState(false);

  const c = useMemo(() => cleanupCandidates(notes as any, tasks as any), [notes, tasks]);

  const clear = (kind: 'emptyNotes' | 'blankTasks' | 'completedTasks' | 'all') => {
    const noteIds = kind === 'emptyNotes' || kind === 'all' ? c.emptyNotes.map((n) => n._id) : [];
    const taskIds = [
      ...(kind === 'blankTasks' || kind === 'all' ? c.blankTasks.map((t) => t._id) : []),
      ...(kind === 'completedTasks' || kind === 'all' ? c.completedTasks.map((t) => t._id) : []),
    ];
    const total = noteIds.length + taskIds.length;
    if (total === 0) return;
    Alert.alert('Bekräfta städning', `Ta bort ${total} objekt? Detta går inte att ångra.`, [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Rensa', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            for (const id of taskIds) await deleteTask(id);
            for (const id of noteIds) await deleteNote(id);
          } finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.box, { borderColor: theme.colors.outline }]}>
      <View style={styles.rowBetween}>
        <Text variant="titleSmall">Städning ({c.total})</Text>
        {c.total > 0 ? <Button mode="contained" compact disabled={busy} onPress={() => clear('all')} buttonColor={theme.colors.error}>Rensa allt</Button> : null}
      </View>
      {c.total === 0 ? (
        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Inget att städa — allt är rent.</Text>
      ) : (
        <View style={{ marginTop: 8, gap: 8 }}>
          <Category title="Tomma anteckningar" items={c.emptyNotes} busy={busy} onClear={() => clear('emptyNotes')} />
          <Category title="Titellösa uppgifter" items={c.blankTasks} busy={busy} onClear={() => clear('blankTasks')} />
          <Category title="Klara uppgifter" items={c.completedTasks} busy={busy} onClear={() => clear('completedTasks')} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 12 },
  cat: { borderWidth: 1, borderRadius: 8, padding: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

export default AdminCleanup;
