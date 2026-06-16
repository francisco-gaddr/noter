import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import { Card, Chip, Text, IconButton, useTheme } from 'react-native-paper';
import { Note, isHiddenSyncedNote } from '@repo/shared';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { noteContentToPlainText } from '@/utils/tiptap';
import * as Haptics from 'expo-haptics';
import { NoteItem } from './NoteItem';

interface NoteTreeProps {
  notes: Note[];
  onRefresh?: () => void;
  refreshing?: boolean;
  onReorder?: (notes: Note[]) => void;
  variant?: 'compact' | 'cards';
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'custom';
  sortOrder?: 'asc' | 'desc';
  onDelete?: (note: Note) => void;
  scrollEnabled?: boolean;
}

interface TreeItem extends Note {
  level: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list') return 'task_list';
  return normalized || 'note';
};

export default function NoteTree({
  notes,
  onRefresh,
  refreshing,
  onReorder,
  variant = 'compact',
  sortBy = 'custom',
  sortOrder = 'asc',
  scrollEnabled = true,
}: NoteTreeProps) {
  const router = useRouter();
  const theme = useTheme();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const lastOrderKeyRef = useRef<string>('');
  const draggedItemRef = useRef<TreeItem | null>(null);
  const visibleNotes = useMemo(() => notes.filter((n) => {
    const type = normalizeNoteType((n as any).type);
    if (type === 'task_list' || type === 'project') return false;
    // Non-editable Nextcloud files (image/PDF/Word/Excel) stay synced + indexed but are hidden
    // from the notes list — only editable text/md synced files show.
    return !isHiddenSyncedNote(n as any);
  }), [notes]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const treeData = useMemo(() => {
    // Pre-index notes by id (O(1) lookup later) and by parent (O(1) children
    // lookup) — this turns the recursive buildTree from O(n²) to O(n log n).
    // With ~200 notes that's the difference between 40k and 800 operations
    // per render, which is the difference between janky scroll and 60fps.
    const byId = new Map<string, Note>();
    const childrenByParent = new Map<string, Note[]>();
    for (const n of visibleNotes) {
      byId.set(n._id, n);
      const key = n.parentId ? String(n.parentId) : '__root__';
      const bucket = childrenByParent.get(key);
      if (bucket) bucket.push(n); else childrenByParent.set(key, [n]);
    }
    // Orphans (note whose parentId points to something not in visibleNotes)
    // are surfaced as roots. We compute them once instead of per-call.
    const orphans: Note[] = [];
    for (const n of visibleNotes) {
      if (n.parentId && !byId.has(String(n.parentId))) orphans.push(n);
    }

    const sortNotes = (arr: Note[]): Note[] => {
      const dir = sortOrder === 'desc' ? -1 : 1;
      const copy = arr.slice();
      copy.sort((a, b) => {
        if (sortBy === 'custom') {
          const orderA = typeof (a as any).order === 'number' ? (a as any).order : 0;
          const orderB = typeof (b as any).order === 'number' ? (b as any).order : 0;
          if (orderA !== orderB) return orderA - orderB;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortBy === 'title') {
          const ta = String(a.title ?? '');
          const tb = String(b.title ?? '');
          const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
          if (cmp !== 0) return cmp * dir;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        const field = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
        const da = new Date((a as any)[field]).getTime();
        const db = new Date((b as any)[field]).getTime();
        if (da !== db) return (da - db) * dir;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      return copy;
    };

    const buildTree = (parentId: string | null, level: number): TreeItem[] => {
      const isRoot = parentId === null;
      const direct = isRoot
        ? [...(childrenByParent.get('__root__') || []), ...orphans]
        : (childrenByParent.get(parentId) || []);
      const sorted = sortNotes(direct);
      const out: TreeItem[] = [];
      for (const note of sorted) {
        const children = childrenByParent.get(note._id);
        const hasChildren = !!children && children.length > 0;
        const isExpanded = expandedIds.has(note._id);
        out.push({ ...note, level, hasChildren, isExpanded } as TreeItem);
        if (hasChildren && isExpanded) {
          for (const child of buildTree(note._id, level + 1)) out.push(child);
        }
      }
      return out;
    };

    return buildTree(null, 0);
  }, [expandedIds, sortBy, sortOrder, visibleNotes]);

  useEffect(() => {
    lastOrderKeyRef.current = treeData.map((n) => n._id).join('|');
  }, [treeData]);

  const toFa5 = useCallback((faKey: string) => {
    const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }, []);

  const getEffectiveParentId = useCallback(
    (note: Note) => {
      if (!note.parentId) return null;
      const parentExists = visibleNotes.some((p) => p._id === note.parentId);
      return parentExists ? note.parentId : null;
    },
    [visibleNotes]
  );

  const getPreviewContent = useCallback((content: any) => noteContentToPlainText(content), []);

  const renderCompactRow = useCallback(
    (item: TreeItem, drag?: () => void, isActive?: boolean) => (
      <NoteItem
        note={item}
        level={item.level}
        hasChildren={item.hasChildren}
        isExpanded={item.isExpanded}
        onToggleExpand={toggleExpand}
        onPress={(note) => router.push(`/note/${note._id}`)}
        onLongPress={() => {
            if (drag) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                drag();
            }
        }}
        isActive={isActive}
      />
    ),
    [router, toggleExpand]
  );

  const renderCardRow = useCallback(
    (item: TreeItem, drag?: () => void, isActive?: boolean) => {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const visibleTags = tags.slice(0, 3);
      return (
        <Card
          style={[
            styles.card,
            { marginLeft: item.level * 14 },
            isActive ? { backgroundColor: theme.colors.elevation.level3 } : null,
          ]}
          onPress={() => router.push(`/note/${item._id}`)}
          onLongPress={drag}
          disabled={isActive}
        >
          <Card.Content>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardExpandIcon}>
                {item.hasChildren ? (
                  <IconButton
                    icon={item.isExpanded ? 'chevron-down' : 'chevron-right'}
                    size={18}
                    onPress={() => toggleExpand(item._id)}
                    style={{ margin: 0 }}
                  />
                ) : null}
              </View>

              <View style={{ width: 24, alignItems: 'center', marginRight: 6 }}>
                {(() => {
                  const iconKey = (item as any).icon as string | undefined;
                  if (iconKey) {
                    return <FontAwesome5 name={toFa5(iconKey) as any} size={18} color={theme.colors.onSurface} />;
                  }

                  if ((item as any).type === 'project') {
                    return <IconButton icon="folder-outline" size={18} style={{ margin: 0 }} iconColor={theme.colors.onSurface} />;
                  }

                  return <IconButton icon="file-document-outline" size={18} style={{ margin: 0 }} iconColor={theme.colors.onSurface} />;
                })()}
              </View>

              <Text variant="titleMedium" numberOfLines={1} style={styles.cardTitle}>
                {item.title}
              </Text>

              {item.locked ? <IconButton icon="lock" size={16} style={{ margin: 0 }} /> : null}
            </View>

            {!item.locked ? (
              <Text variant="bodyMedium" numberOfLines={3} style={styles.cardContent}>
                {getPreviewContent(item.content)}
              </Text>
            ) : null}

            <View style={styles.tagsRow}>
              {visibleTags.map((tag, index) => (
                <Chip key={`${item._id}-${index}`} style={styles.chip} textStyle={{ fontSize: 10 }}>
                  {tag}
                </Chip>
              ))}
            </View>
          </Card.Content>
        </Card>
      );
    },
    [getPreviewContent, router, theme.colors.elevation.level3, theme.colors.onSurface, toggleExpand, toFa5]
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<TreeItem>) => (
      <ScaleDecorator>{variant === 'cards' ? renderCardRow(item, drag, isActive) : renderCompactRow(item, drag, isActive)}</ScaleDecorator>
    ),
    [renderCardRow, renderCompactRow, variant]
  );

  const handleDragEnd = useCallback(
    ({ data, from, to }: { data: TreeItem[]; from: number; to: number }) => {
      if (!onReorder || !draggedItemRef.current || from === to) return;

      const movedItem = draggedItemRef.current;
      
      // Determine new parent based on drop position
      // data[to] is the moved item in its new position
      const prevItem = to > 0 ? data[to - 1] : null;
      
      let newParentId: string | null = null;
      
      if (!prevItem) {
        // Dropped at the top -> Root
        newParentId = null;
      } else {
        // If the item above is expanded, it becomes the first child
        if (prevItem.isExpanded) {
          newParentId = prevItem._id;
        } else {
          // Otherwise, it adopts the parent of the item above (becoming a sibling)
          newParentId = prevItem.parentId ?? null;
        }
      }

      // Filter siblings from the NEW data order
      const siblings = data
        .filter((item, index) => {
          // If it's the moved item, treat it as having the newParentId
          if (index === to) return true;
          // For others, use their existing parentId
          return item.parentId === newParentId;
        })
        .map(item => {
          if (item._id === movedItem._id) {
            return { ...item, parentId: newParentId };
          }
          return item;
        });

      if (siblings.length > 0) {
        onReorder(siblings);
      }
      draggedItemRef.current = null;
    },
    [onReorder]
  );

  return (
    <View style={styles.container}>
      {!scrollEnabled ? (
        <View style={variant === 'cards' ? styles.listContent : undefined}>
          {treeData.map((item, index) => (
             <React.Fragment key={item._id}>
                {variant === 'cards' ? renderCardRow(item) : renderCompactRow(item)}
             </React.Fragment>
          ))}
        </View>
      ) : onReorder ? (
        <DraggableFlatList<TreeItem>
          data={treeData}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          onDragEnd={handleDragEnd}
          onDragBegin={(index) => {
            Haptics.selectionAsync();
            draggedItemRef.current = treeData[index];
          }}
          // Explicit RefreshControl (more reliable than the bare props across list libs) +
          // a min-height empty component + flexGrow so pull-to-refresh works EVEN when the
          // folder is empty (otherwise there's nothing to grab and the gesture does nothing).
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} /> : undefined}
          ListEmptyComponent={onRefresh ? <View style={styles.pullEmptyArea} /> : null}
          contentContainerStyle={[treeData.length === 0 ? styles.emptyGrow : null, variant === 'cards' ? styles.listContent : null]}
        />
      ) : (
        <FlashList
          data={treeData}
          renderItem={({ item }) => (variant === 'cards' ? renderCardRow(item) : renderCompactRow(item))}
          keyExtractor={(item) => item._id}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} /> : undefined}
          ListEmptyComponent={onRefresh ? <View style={styles.pullEmptyArea} /> : null}
          contentContainerStyle={variant === 'cards' ? styles.listContent : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  // Gives pull-to-refresh a grabbable area when the list is empty.
  pullEmptyArea: {
    minHeight: 500,
  },
  emptyGrow: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  listContent: {
    padding: 10,
  },
  card: {
    marginBottom: 10,
  },
  iconContainer: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardExpandIcon: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 16,
    marginLeft: 5,
  },
  cardTitle: {
    flex: 1,
    fontWeight: 'bold',
  },
  cardContent: {
    marginTop: 5,
  },
  tagsRow: {
    flexDirection: 'row',
    marginTop: 10,
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: 5,
    height: 24,
  },
});
