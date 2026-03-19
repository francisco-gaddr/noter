import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Alert } from 'react-native';
import { FAB, ActivityIndicator, IconButton, Menu, Divider, Text, Button, Avatar, useTheme } from 'react-native-paper';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/stores/useStore';
import NoteList from '@/components/NoteList';
import ProjectSelector from '@/components/ProjectSelector';
import IconPickerModal from '@/components/IconPickerModal';
import { SvgUri } from 'react-native-svg';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { Note, normalizeNoteType, normalizeId } from '@repo/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTES_SORT_KEY = 'notes_sort_settings';

const HeaderProjectIcon = ({ uri, onLongPress, onPress }: { uri?: string, onLongPress: () => void, onPress: () => void }) => {
  const theme = useTheme();
  
  const renderIcon = () => {
    if (!uri) return <IconButton icon="folder-multiple-outline" onPress={onPress} onLongPress={onLongPress} />;
    
    if (uri.startsWith('Fa')) {
        const toFa5 = (faKey: string) => {
            const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
            return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        };
        return (
            <TouchableOpacity onPress={onPress} onLongPress={onLongPress} style={{ padding: 8 }}>
                <FontAwesome5 name={toFa5(uri) as any} size={24} color={theme.colors.onSurface} />
            </TouchableOpacity>
        );
    }
    
    return (
        <TouchableOpacity onPress={onPress} onLongPress={onLongPress} style={{ padding: 8 }}>
            <SvgUri uri={uri} width={24} height={24} />
        </TouchableOpacity>
    );
  };

  return renderIcon();
};

export default function NotesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { notes, isLoading, error, fetchNotes, viewMode, setViewMode, activeProjectId, updateNote, reorderNotes, deleteNote } = useStore();
  
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [projectSelectorVisible, setProjectSelectorVisible] = useState(false);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'updatedAt' | 'custom'>('createdAt');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    const normalizedActive = normalizeId(activeProjectId);
    if (!normalizedActive) return null;
    return notes.find((n) => normalizeId(n._id) === normalizedActive) || null;
  }, [activeProjectId, notes]);

  const handleIconSelect = async (icon: string) => {
    if (activeProjectId) {
        await updateNote(activeProjectId, { icon });
        setIconPickerVisible(false);
        fetchNotes();
    }
  };


  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!loadedRef.current) {
        fetchNotes();
        loadedRef.current = true;
      }
    }, [])
  );

  useEffect(() => {
    AsyncStorage.getItem(NOTES_SORT_KEY)
      .then((saved) => {
        if (!saved) {
            setSettingsLoaded(true);
            return;
        }
        const parsed = JSON.parse(saved);
        if (parsed?.sortBy) setSortBy(parsed.sortBy);
        if (parsed?.sortOrder) setSortOrder(parsed.sortOrder);
        setSettingsLoaded(true);
      })
      .catch(() => {
          setSettingsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    AsyncStorage.setItem(NOTES_SORT_KEY, JSON.stringify({ sortBy, sortOrder })).catch(() => {});
  }, [sortBy, sortOrder, settingsLoaded]);

  const getNextViewMode = () => {
    return viewMode === 'list' ? 'tree' : 'list';
  };

  const getViewIcon = () => {
    if (viewMode === 'list') return 'file-tree';
    return 'view-list';
  };

  const handleReorder = useCallback(
    async (nextNotes: any[]) => {
      try {
        setSortBy('custom');
        setSortOrder('asc');
        await reorderNotes(nextNotes as any);
      } catch (e) {
      }
    },
    [reorderNotes]
  );

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity onPress={() => setProjectSelectorVisible(true)} style={{ paddingVertical: 6 }}>
          <Text variant="titleMedium" numberOfLines={1}>
            {activeProject ? activeProject.title : 'Notes'}
          </Text>
        </TouchableOpacity>
      ),
      headerLeft: () => (
        <View style={{ marginLeft: 16 }}>
             <HeaderProjectIcon 
                uri={(activeProject as any)?.icon} 
                onPress={() => setProjectSelectorVisible(true)}
                onLongPress={() => activeProjectId && setIconPickerVisible(true)}
             />
        </View>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="magnify"
            onPress={() => router.push('/(tabs)/search')}
          />
          <IconButton
            icon="cog"
            onPress={() => router.push('/(tabs)/settings')}
          />
          <Menu
            visible={sortMenuVisible}
            onDismiss={() => setSortMenuVisible(false)}
            anchor={
              <IconButton
                icon="sort"
                onPress={() => {
                  setSortMenuVisible(false);
                  setTimeout(() => setSortMenuVisible(true), 0);
                }}
              />
            }
          >
            <Menu.Item
              onPress={() => { setSortBy('custom'); setSortOrder('asc'); setSortMenuVisible(false); }}
              title="Custom"
              leadingIcon={sortBy === 'custom' ? 'check' : undefined}
            />
            <Divider />
            <Menu.Item 
              onPress={() => { setSortBy('createdAt'); setSortOrder('desc'); setSortMenuVisible(false); }} 
              title="Newest first" 
              leadingIcon={sortBy === 'createdAt' && sortOrder === 'desc' ? 'check' : undefined}
            />
            <Menu.Item 
              onPress={() => { setSortBy('createdAt'); setSortOrder('asc'); setSortMenuVisible(false); }} 
              title="Oldest first"
              leadingIcon={sortBy === 'createdAt' && sortOrder === 'asc' ? 'check' : undefined}
            />
            <Divider />
            <Menu.Item 
              onPress={() => { setSortBy('title'); setSortOrder('asc'); setSortMenuVisible(false); }} 
              title="Title A-Z"
              leadingIcon={sortBy === 'title' && sortOrder === 'asc' ? 'check' : undefined}
            />
            <Menu.Item 
              onPress={() => { setSortBy('updatedAt'); setSortOrder('desc'); setSortMenuVisible(false); }} 
              title="Recently Updated"
              leadingIcon={sortBy === 'updatedAt' && sortOrder === 'desc' ? 'check' : undefined}
            />
          </Menu>
          <IconButton
            icon={getViewIcon()}
            onPress={() => setViewMode(getNextViewMode())}
          />
        </View>
      ),
    });
  }, [navigation, viewMode, setViewMode, sortMenuVisible, sortOrder, sortBy, activeProjectId, activeProject]);

  const sortedNotes = useMemo(() => {
    let filtered = notes.filter((n) => {
      const type = normalizeNoteType((n as any).type);
      return type !== 'project' && type !== 'task_list';
    });

    const noteById = new Map<string, Note>();
    for (const note of notes) {
      const noteId = normalizeId(note._id);
      if (!noteId) continue;
      noteById.set(noteId, note);
    }

    if (!activeProjectId) {
      filtered = filtered.filter((note) => {
        let parentId = normalizeId(note.parentId);
        let guard = 0;
        while (parentId && guard < 200) {
          const parent = noteById.get(parentId);
          if (!parent) return true;
          const parentType = normalizeNoteType((parent as any).type);
          if (parentType === 'project' && parent.locked) return false;
          parentId = normalizeId(parent.parentId);
          guard += 1;
        }
        return true;
      });
    }

    if (activeProjectId) {
      const normalizedActiveProjectId = normalizeId(activeProjectId);
      if (!normalizedActiveProjectId) return filtered;

      filtered = filtered.filter((note) => {
        let parentId = normalizeId(note.parentId);
        let guard = 0;
        while (parentId && guard < 200) {
          if (parentId === normalizedActiveProjectId) return true;
          const parent = noteById.get(parentId);
          if (!parent) return false;
          parentId = normalizeId(parent.parentId);
          guard += 1;
        }
        return false;
      });
    }

    return filtered;
  }, [notes, activeProjectId, viewMode]);

  const handleCreateNote = () => {
    router.push({
      pathname: '/note/new',
      params: activeProjectId ? { parentId: activeProjectId } : {},
    } as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {error && (
        <View style={{ padding: 10, backgroundColor: '#ffebee', margin: 10, borderRadius: 5 }}>
            <Text style={{ color: '#c62828' }}>Error loading notes: {error}</Text>
            <Button mode="text" onPress={fetchNotes}>Retry</Button>
        </View>
      )}
      <ProjectSelector 
        visible={projectSelectorVisible} 
        onDismiss={() => setProjectSelectorVisible(false)} 
      />
      <IconPickerModal
        visible={iconPickerVisible}
        onDismiss={() => setIconPickerVisible(false)}
        onSelect={handleIconSelect}
      />
      <NoteList 
        notes={sortedNotes} 
        onRefresh={fetchNotes}
        refreshing={isLoading}
        viewMode={viewMode}
        onReorder={handleReorder}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onDelete={(note) => {
            Alert.alert(
                "Delete Note",
                "Are you sure you want to delete this note?",
                [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteNote(note._id) }
                ]
            );
        }}
      />
      
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleCreateNote}
        label={t('note.new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});
