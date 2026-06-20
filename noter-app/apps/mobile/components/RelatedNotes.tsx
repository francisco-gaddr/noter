import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { relatedNotes, type RelatedNote, type Note, type Task } from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { getVectorIndex, getEmbeddingsConfig } from '@/services/ai/embeddingsService';

/**
 * "Related notes" — the most semantically similar notes/tasks to the one being viewed, from the local
 * embedding index (parity with web's RelatedNotesPanel). Pure reuse of the shared lock-safe
 * relatedNotes(): no AI/network call, on-device, and locked notes can never surface. Renders nothing
 * until embeddings exist or when nothing is related.
 */
export function RelatedNotes({ noteId }: { noteId: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const [related, setRelated] = useState<RelatedNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getEmbeddingsConfig();
        const index = await getVectorIndex(cfg.model);
        const out = relatedNotes(index, noteId, notes as Note[], tasks as Task[], 5);
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
          <Text style={styles.score}>{Math.round(r.score * 100)}%</Text>
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
