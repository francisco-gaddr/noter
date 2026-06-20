import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { agentSearchNotes, type AgentSearchHit, type Note, type Task } from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { getFeatureSettings } from '@/services/featureSettings';

/**
 * #1 Inline auto-linking (parity with web) — surfaces related notes/tasks live as you write, via the
 * shared lock-safe agentSearchNotes() (lexical + rerank, no AI/embedding call, on-device). Keyed off
 * the current note's title + content so it refreshes as the draft saves. Gated by the `autoLink`
 * feature toggle. Locked notes can never appear.
 */
export function RelatedNotes({ noteId }: { noteId: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const [related, setRelated] = useState<AgentSearchHit[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getFeatureSettings();
        if (!settings.autoLink.enabled) { if (!cancelled) setRelated([]); return; }
        const note = (notes as Note[]).find((n) => n._id === noteId);
        if (!note) { if (!cancelled) setRelated([]); return; }
        const query = `${note.title || ''} ${note.content || ''}`;
        const out = agentSearchNotes(notes as Note[], tasks as Task[], query, 6)
          .filter((r) => r.id !== noteId)
          .slice(0, 5);
        if (!cancelled) setRelated(out);
      } catch {
        if (!cancelled) setRelated([]);
      }
    })();
    return () => { cancelled = true; };
  }, [noteId, notes, tasks]);

  if (related.length === 0) return null;

  return (
    <View style={[styles.wrap, { borderTopColor: theme.colors.outlineVariant }]}>
      <Text variant="labelMedium" style={styles.heading}>{t('relatedNotes.title')}</Text>
      {related.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => router.push(r.kind === 'task' ? `/task/${r.id}` : `/note/${r.id}`)}
          style={styles.row}
        >
          <Text numberOfLines={1} style={styles.title}>{r.title?.trim() || t('relatedNotes.untitled')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  heading: { opacity: 0.7, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  title: { flex: 1 },
  score: { opacity: 0.5, marginLeft: 8 },
});
