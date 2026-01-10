import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Searchbar, Text, Divider, useTheme } from 'react-native-paper';
import Fuse from 'fuse.js';
import { useStore } from '@/stores/useStore';
import NoteList from '@/components/NoteList';
import TaskList from '@/components/TaskList';
import { Note, Task } from '@repo/shared';

export default function SearchScreen() {
  const { notes, tasks, updateTask } = useStore();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

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
    if (!searchQuery) return [];
    return noteFuse.search(searchQuery).map(result => result.item);
  }, [searchQuery, noteFuse]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery) return [];
    return taskFuse.search(searchQuery).map(result => result.item);
  }, [searchQuery, taskFuse]);

  const handleToggleTask = async (task: Task) => {
    try {
      await updateTask(task._id, { completed: !task.completed });
    } catch (error) {
      console.error('Failed to update task', error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        <Searchbar
          placeholder="Search notes & tasks..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          autoFocus
        />
      </View>
      
      {searchQuery ? (
        <ScrollView style={styles.resultsContainer}>
          {filteredNotes.length > 0 && (
            <View>
              <Text variant="titleMedium" style={styles.sectionTitle}>Notes ({filteredNotes.length})</Text>
              <NoteList notes={filteredNotes} />
            </View>
          )}

          {filteredNotes.length > 0 && filteredTasks.length > 0 && <Divider style={styles.divider} />}

          {filteredTasks.length > 0 && (
            <View>
              <Text variant="titleMedium" style={styles.sectionTitle}>Tasks ({filteredTasks.length})</Text>
              <TaskList tasks={filteredTasks} onToggleComplete={handleToggleTask} showViewToggle={false} />
            </View>
          )}

          {filteredNotes.length === 0 && filteredTasks.length === 0 && (
            <View style={styles.emptyContainer}>
              <Text variant="bodyLarge">No results found</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.emptyContainer}>
          <Text variant="bodyLarge" style={{ opacity: 0.5 }}>Type to search...</Text>
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
  resultsContainer: {
    flex: 1,
  },
  sectionTitle: {
    padding: 16,
    paddingBottom: 8,
  },
  divider: {
    marginVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    opacity: 0.5,
  },
});
