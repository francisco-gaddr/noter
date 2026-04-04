import React, { useDeferredValue, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Searchbar, Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import Fuse from 'fuse.js';
import { useStore } from '@/stores/useStore';
import { NoteItem } from '@/components/NoteItem';
import { TaskItem } from '@/components/TaskItem';
import { Note, Task, normalizeNoteType } from '@repo/shared';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '@/services/ai/security';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

type SearchResultRow =
  | { id: string; type: 'header'; title: string }
  | { id: string; type: 'note'; note: Note }
  | { id: string; type: 'task'; task: Task };

const SEARCH_RESULT_LIMIT = 200;

export default function SearchScreen() {
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);
  const updateTask = useStore((state) => state.updateTask);
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const noteFuse = useMemo(() => {
    return new Fuse(notes, {
      keys: ['title', 'content', 'tags'],
      threshold: 0.3,
    });
  }, [notes]);

  const taskFuse = useMemo(() => {
    return new Fuse(tasks, {
      keys: ['title', 'description'],
      threshold: 0.3,
    });
  }, [tasks]);

  const filteredNotes = useMemo(() => {
    if (!deferredSearchQuery) return [];
    const map = buildSecurityNoteMap(notes as any);
    return noteFuse
      .search(deferredSearchQuery)
      .map((result) => result.item)
      .filter((note) => {
        const type = normalizeNoteType((note as any).type);
        if (type === 'project' && note.locked) return false;
        const blocking = findBlockingLockedAncestor(note as any, map as any, new Set() as any);
        return !blocking;
      });
  }, [deferredSearchQuery, noteFuse, notes]);

  const filteredTasks = useMemo(() => {
    if (!deferredSearchQuery) return [];
    return taskFuse.search(deferredSearchQuery).map(result => result.item);
  }, [deferredSearchQuery, taskFuse]);

  const searchResults = useMemo<SearchResultRow[]>(() => {
    if (!deferredSearchQuery) return [];
    const rows: SearchResultRow[] = [];
    const limitedNotes = filteredNotes.slice(0, SEARCH_RESULT_LIMIT);
    const remainingSlots = Math.max(SEARCH_RESULT_LIMIT - limitedNotes.length, 0);
    const limitedTasks = filteredTasks.slice(0, remainingSlots);
    if (limitedNotes.length > 0) {
      rows.push({ id: 'notes-header', type: 'header', title: t('search.notes', { count: filteredNotes.length }) });
      rows.push(...limitedNotes.map((note) => ({ id: `note-${note._id}`, type: 'note' as const, note })));
    }
    if (limitedTasks.length > 0) {
      rows.push({ id: 'tasks-header', type: 'header', title: t('search.tasks', { count: filteredTasks.length }) });
      rows.push(...limitedTasks.map((task) => ({ id: `task-${task._id}`, type: 'task' as const, task })));
    }
    return rows;
  }, [deferredSearchQuery, filteredNotes, filteredTasks, t]);

  const handleToggleTask = async (task: Task) => {
    try {
      await updateTask(task._id, { completed: !task.completed });
    } catch (error) {
      console.error('Failed to update task', error);
    }
  };

  const renderSearchResult = ({ item }: { item: SearchResultRow }) => {
    if (item.type === 'header') {
      return <Text variant="titleMedium" style={styles.sectionTitle}>{item.title}</Text>;
    }
    if (item.type === 'note') {
      return <NoteItem note={item.note} onPress={(note) => router.push(`/note/${note._id}`)} />;
    }
    return (
      <TaskItem
        task={item.task}
        onPress={(task) => router.push(`/task/${task._id}`)}
        onToggleComplete={handleToggleTask}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        <Searchbar
          placeholder={t('search.placeholder')}
          onChangeText={setSearchQuery}
          value={searchQuery}
          autoFocus
        />
      </View>
      
      {searchQuery ? (
        searchResults.length > 0 ? (
          <FlashList
            data={searchResults}
            renderItem={renderSearchResult}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.resultsContent}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Text variant="bodyLarge">{t('search.noResults')}</Text>
          </View>
        )
      ) : (
        <View style={styles.emptyContainer}>
          <Text variant="bodyLarge" style={{ opacity: 0.5 }}>{t('search.typeToSearch')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    padding: 16,
    elevation: 2,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    padding: 16,
    paddingBottom: 8,
  },
  resultsContent: {
    paddingBottom: 24,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    opacity: 0.5,
  },
});
