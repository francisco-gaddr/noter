import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Alert } from 'react-native';
import { FAB, ActivityIndicator, IconButton, Menu, Divider, Text, Button, Avatar, useTheme } from 'react-native-paper';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useStore } from '@/stores/useStore';
import NoteList from '@/components/NoteList';
import ProjectSelector from '@/components/ProjectSelector';
import IconPickerModal from '@/components/IconPickerModal';
import { SvgUri } from 'react-native-svg';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { Note } from '@repo/shared';

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
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { notes, isLoading, error, fetchNotes, viewMode, setViewMode, activeProjectId, updateNote, reorderNotes, deleteNote } = useStore();
  
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [projectSelectorVisible, setProjectSelectorVisible] = useState(false);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'updatedAt' | 'custom'>('createdAt');

  const activeProject = useMemo(() => 
    activeProjectId ? notes.find(n => n._id === activeProjectId) : null
  , [activeProjectId, notes]);

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
        <View style={{ flexDirection: 'row' }}>
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
    let filtered = notes;

    if (activeProjectId) {
      const byParent = new Map<string, Note[]>();
      for (const n of notes) {
        if (!n.parentId) continue;
        const arr = byParent.get(n.parentId);
        if (arr) arr.push(n);
        else byParent.set(n.parentId, [n]);
      }

      const included = new Set<string>();
      const queue: string[] = [activeProjectId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = byParent.get(current) ?? [];
        for (const child of children) {
          if (included.has(child._id)) continue;
          included.add(child._id);
          queue.push(child._id);
        }
      }

      filtered = notes.filter((n) => included.has(n._id));
    }

    const hasChildrenMap = new Map<string, boolean>();
    for (const n of notes) {
      if (n.parentId) hasChildrenMap.set(n.parentId, true);
    }

  const isProjectLike = (note: Note) => {
  const noteType = (note as any).type;
  if (noteType === 'project') return true;
  if (noteType === 'task_list') return true;
  if (noteType && noteType !== 'note') return true;
  
  const icon = (note as any).icon;
  if (typeof icon === 'string' && (icon.includes('folder') || icon.includes('project'))) return true;

  if (noteType === 'note') return false;
  
  // For index view, we can't easily check children without the full map.
  // But we can check content.
  const raw = typeof note.content === 'string' ? note.content : '';
  const text = raw.replace(/<[^>]*>/g, '').trim();
  if (text.length === 0) return true;

  // If we have access to hasChildrenMap (from context or recalc), use it. 
  // Here we only have local check.
  if (hasChildrenMap.get(note._id)) return true;

  return false;
};

    filtered = filtered.filter((n) => !isProjectLike(n));

    return filtered;
  }, [notes, activeProjectId]);

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
        label="New Note"
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
