import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Alert } from 'react-native';
import { FAB, ActivityIndicator, IconButton, Menu, Divider, Text, Button, Avatar, useTheme, Snackbar } from 'react-native-paper';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/stores/useStore';
import NoteList from '@/components/NoteList';
import ProjectSelector from '@/components/ProjectSelector';
import IconPickerModal from '@/components/IconPickerModal';
import { SvgUri } from 'react-native-svg';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { Note, isBlankNote, buildSecurityNoteMap, isReadableWithLocks, isHiddenSyncedNote } from '@repo/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSettings } from '@/services/storage';
import { getSocket } from '@/services/socket';
import { pushAllMarkdownShares, drainMarkdownMutations } from '@/services/markdownShare';
import { SkeletonRow } from '@/components/Skeleton';
import { useRefreshControl } from '@/hooks/useRefreshControl';

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  let normalized = value.trim().toLowerCase();
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/\s+/g, '_');
  normalized = normalized.replace(/-/g, '_');
  if (normalized === 'projectfolder' || normalized === 'project_folder') return 'project';
  if (normalized.includes('project') || normalized.includes('folder')) return 'project';
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list' || normalized === 'task_list') return 'task_list';
  if (normalized.includes('task') && normalized.includes('list')) return 'task_list';
  return normalized || 'note';
};

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  let normalized = value.trim();
  if (!normalized) return null;
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized || null;
};

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
  const unlockedProtectedNoteIds = useStore((s) => s.unlockedProtectedNoteIds);
  const syncingSources = useStore((s) => s.syncingCount > 0);

  // Standardised pull-to-refresh: haptic on initiation, minimum 350ms spinner
  // so a fast-cached response doesn't flicker the UI, reentrancy-guarded so
  // multiple drags can't queue parallel fetches. Section-aware: inside a
  // Nextcloud-backed project folder it pulls THAT folder fresh from the server;
  // at the notes root it forces every source (Nextcloud + CalDAV) then refetches.
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const { refreshing: pullRefreshing, onRefresh: onPullRefresh } = useRefreshControl(
    async () => {
      let msg = '';
      try {
        if (activeProjectId) {
          const nc = await import('@/services/nextcloud');
          const r = await nc.forceSyncFolder(activeProjectId);
          if (r.matched) {
            msg = r.ok
              ? `Synkad: ${r.created} nya, ${r.updated} uppdaterade, ${r.deleted} borttagna, ${r.pushed} skickade`
              : `Synk-fel: ${r.error || 'okänt'}`;
          } else {
            const fs = await import('@/services/forceSync');
            const fr = await fs.forceSyncAllSources();
            msg = fr.ok
              ? `Synkade alla källor (${fr.nextcloud.created + fr.nextcloud.updated} ändringar)`
              : `Synk-fel: ${fr.error || 'okänt'}`;
          }
        } else {
          const fs = await import('@/services/forceSync');
          const fr = await fs.forceSyncAllSources();
          msg = fr.ok
            ? `Synkade alla källor (${fr.nextcloud.created + fr.nextcloud.updated} ändringar)`
            : `Synk-fel: ${fr.error || 'okänt'}`;
        }
      } catch (e: any) { msg = `Synk-fel: ${e?.message || 'okänt'}`; }
      await fetchNotes();
      setSyncMsg(msg || 'Uppdaterat');
    },
  );
  
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [viewMenuVisible, setViewMenuVisible] = useState(false);
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
      // External Markdown sync: drain any inbound edits made from Obsidian/Finder/Android
      // when the notes screen regains focus (no-op unless a share exists).
      void drainMarkdownMutations().catch(() => {});
    }, [])
  );

  // Keep external Markdown shares' projection live: re-push (lock-aware) when notes change.
  // Debounced so a burst of edits is one push. No-op unless a share exists.
  useEffect(() => {
    const h = setTimeout(() => { void pushAllMarkdownShares().catch(() => {}); }, 1500);
    return () => clearTimeout(h);
  }, [notes]);

  // Fast two-way: drain INSTANTLY on the backend `markdown:mutation` nudge.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onMutation = () => { void drainMarkdownMutations().catch(() => {}); };
    s.on('markdown:mutation', onMutation);
    return () => { s.off('markdown:mutation', onMutation); };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(NOTES_SORT_KEY)
      .then((saved) => {
        if (!saved) return;
        // Defensive parse: corrupt JSON or wrong-type values were silently
        // setting `undefined` onto sortBy/sortOrder before. parseSettings is
        // already-defined schema for these exact field names (notesSortBy /
        // notesSortOrder) and returns the defaults on validation failure.
        try {
          const parsed = JSON.parse(saved);
          const { settings } = parseSettings({
            notesSortBy: parsed?.sortBy,
            notesSortOrder: parsed?.sortOrder,
          });
          setSortBy(settings.notesSortBy);
          setSortOrder(settings.notesSortOrder);
        } catch {
          // corrupt JSON — leave defaults
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(NOTES_SORT_KEY, JSON.stringify({ sortBy, sortOrder })).catch(() => {});
  }, [sortBy, sortOrder]);

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
          {/* View picker dropdown: Listvy / Kortvy / Grafvy. Replaces the old separate
              graph button + toggle. The anchor force-reopens (close→reopen on the next
              tick) so the Menu never gets wedged after a couple of taps. */}
          <Menu
            visible={viewMenuVisible}
            onDismiss={() => setViewMenuVisible(false)}
            anchor={
              <IconButton
                icon={viewMode === 'tree' ? 'view-grid-outline' : 'view-list-outline'}
                onPress={() => { setViewMenuVisible(false); setTimeout(() => setViewMenuVisible(true), 0); }}
                testID="open-view-menu"
              />
            }
          >
            <Menu.Item
              onPress={() => { setViewMode('list'); setViewMenuVisible(false); }}
              title={t('view.list', 'Listvy')}
              leadingIcon={viewMode === 'list' ? 'check' : 'view-list-outline'}
            />
            <Menu.Item
              onPress={() => { setViewMode('tree'); setViewMenuVisible(false); }}
              title={t('view.card', 'Kortvy')}
              leadingIcon={viewMode === 'tree' ? 'check' : 'view-grid-outline'}
            />
            <Divider />
            <Menu.Item
              onPress={() => { setViewMenuVisible(false); router.push('/graph'); }}
              title={t('view.graph', 'Grafvy')}
              leadingIcon="graph-outline"
              testID="open-graph-explorer"
            />
          </Menu>
        </View>
      ),
    });
  }, [navigation, viewMode, setViewMode, sortMenuVisible, viewMenuVisible, sortOrder, sortBy, activeProjectId, activeProject]);

  const sortedNotes = useMemo(() => {
    // SECURITY (hard guarantee): a note whose ancestor project/folder is locked-and-not-
    // unlocked must NEVER appear in the all-notes list — not even masked. We filter by the
    // CURRENT unlock state here (defense-in-depth on top of the store's materialise mask),
    // so a stale decrypted cache or a re-locked folder can't leak. To unlock, open the
    // folder and enter its password.
    const securityMap = buildSecurityNoteMap(notes as any);
    const unlockedSet = new Set(unlockedProtectedNoteIds || []);
    let filtered = notes.filter((n) => {
      if (!isReadableWithLocks(n as any, securityMap as any, unlockedSet)) return false;
      const type = normalizeNoteType((n as any).type);
      // Non-editable synced files (images/PDF/Word/Excel) stay indexed + in the graph but never
      // appear in the notes list — only editable text files from Nextcloud are shown.
      if (isHiddenSyncedNote(n as any)) return false;
      // Only plain notes with real content — folders and completely-empty notes
      // (junk from failed syncs) never appear in the notes list.
      return type !== 'project' && type !== 'task_list' && !isBlankNote({ title: n.title, content: n.content, type: 'note' });
    });

    if (activeProjectId) {
      const byParent = new Map<string, Note[]>();
      const normalizedActiveProjectId = normalizeId(activeProjectId);
      if (!normalizedActiveProjectId) return filtered;
      for (const n of notes) {
        const normalizedParentId = normalizeId(n.parentId);
        if (!normalizedParentId) continue;
        const arr = byParent.get(normalizedParentId);
        if (arr) arr.push(n);
        else byParent.set(normalizedParentId, [n]);
      }

      const included = new Set<string>();
      const queue: string[] = [normalizedActiveProjectId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = byParent.get(current) ?? [];
        for (const child of children) {
          const normalizedChildId = normalizeId(child._id);
          if (!normalizedChildId || included.has(normalizedChildId)) continue;
          included.add(normalizedChildId);
          queue.push(normalizedChildId);
        }
      }

      filtered = filtered.filter((n) => {
        const normalizedId = normalizeId(n._id);
        return normalizedId ? included.has(normalizedId) : false;
      });
    }

    return filtered;
  }, [notes, activeProjectId, viewMode, unlockedProtectedNoteIds]);

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
      {syncingSources && sortedNotes.length === 0 ? (
        // The current section is empty AND a source sync (Nextcloud/CalDAV) is in flight —
        // show an explicit "syncing from server" loader so it doesn't look broken/empty.
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 10 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: theme.colors.onSurfaceVariant }}>Synkar från servern…</Text>
        </View>
      ) : isLoading && sortedNotes.length === 0 ? (
        // Cold-start placeholder: skeletons let the user see "something is
        // happening" without staring at an empty screen. Reduce-motion is
        // honoured by Skeleton internally.
        <SkeletonRow count={6} />
      ) : null}
      <NoteList
        notes={sortedNotes}
        onRefresh={onPullRefresh}
        refreshing={pullRefreshing || (isLoading && sortedNotes.length > 0)}
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
      <Snackbar
        visible={!!syncMsg}
        onDismiss={() => setSyncMsg(null)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setSyncMsg(null) }}
      >
        {syncMsg || ''}
      </Snackbar>
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
