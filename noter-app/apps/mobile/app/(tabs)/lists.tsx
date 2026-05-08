import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { List, IconButton, TextInput, FAB, useTheme, Divider, Text } from 'react-native-paper';
import { useStore } from '@/stores/useStore';
import { Note } from '@repo/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { orderBy } from 'lodash';
import { useTranslation } from 'react-i18next';
import { getReadableProtectedLabel } from '@/utils/protectedNote';

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list') return 'task_list';
  return normalized || 'note';
};

export default function ListsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { notes, fetchNotes, createNote, updateNote, deleteNote } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchNotes();
    }, [])
  );

  const lists = orderBy(notes.filter((n) => normalizeNoteType((n as any).type) === 'task_list'), ['updatedAt'], ['desc']);

  const getListLabel = useCallback((note: Note) => (
    getReadableProtectedLabel(
      (note as any).__rawEncryptedTitle ?? note.title,
      note.title,
      t('tasks.listFallback'),
    )
  ), [t]);

  const startEdit = (note: Note) => {
    setEditingId(note._id);
    setEditingTitle(getListLabel(note));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setIsLoading(true);
    try {
      await updateNote(editingId, { title: editingTitle });
      setEditingId(null);
      setEditingTitle('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsLoading(true);
    try {
      const created = await createNote({ title: t('tasks.newList'), content: '', type: 'task_list' });
      setEditingId(created._id);
      setEditingTitle(created.title || '');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsLoading(true);
    try {
      await deleteNote(id);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView>
        <List.Section title={t('lists.title')}>
        {lists.length === 0 && (
          <View style={styles.empty}>
            <Text variant="bodySmall">{t('lists.empty')}</Text>
          </View>
        )}
        {/* "Alla" list (virtual, non-removable) */}
        <View>
          <TouchableOpacity activeOpacity={0.8}>
            <List.Item
              title={t('common.all')}
              left={props => <List.Icon {...props} icon="format-list-checks" />}
              right={() => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <IconButton icon="lock" disabled />
                </View>
              )}
            />
          </TouchableOpacity>
          <Divider />
        </View>

        {lists.map(list => (
          <View key={list._id}>
            {editingId === list._id ? (
              <View style={styles.editRow}>
                <TextInput
                  value={editingTitle}
                  onChangeText={setEditingTitle}
                  mode="outlined"
                  style={{ flex: 1 }}
                />
                <IconButton icon="content-save" onPress={saveEdit} disabled={isLoading} />
                <IconButton icon="close" onPress={() => { setEditingId(null); setEditingTitle(''); }} />
              </View>
            ) : (
              <TouchableOpacity activeOpacity={0.8} onLongPress={() => startEdit(list)}>
                <List.Item
                  title={getListLabel(list)}
                  left={props => <List.Icon {...props} icon="format-list-bulleted" />}
                  right={() => (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <IconButton icon="delete" onPress={() => handleDelete(list._id)} />
                    </View>
                  )}
                />
              </TouchableOpacity>
            )}
            <Divider />
          </View>
        ))}
      </List.Section>
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleCreate}
        disabled={isLoading}
        label={t('tasks.newList')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
