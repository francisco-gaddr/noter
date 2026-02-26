import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { Card, Chip, Text, IconButton, useTheme } from 'react-native-paper';
import { Note } from '@repo/shared';
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
  const visibleNotes = useMemo(() => {
    const hasChildrenMap = new Map<string, boolean>();
    for (const n of notes) {
      if (n.parentId) hasChildrenMap.set(n.parentId, true);
    }

    const isProjectLike = (note: Note) => {
      const noteType = (note as any).type;
      if (noteType === 'project') return true;
      if (noteType === 'task_list') return true;
      if (noteType && noteType !== 'note') return true;
      
      // Check icon as heuristic for legacy projects
      const icon = (note as any).icon;
      if (typeof icon === 'string' && (icon.includes('folder') || icon.includes('project'))) return true;

      // If explicitly a note, return false (unless it matched icon above)
      if (noteType === 'note') return false;

      // If type is undefined/unknown:
      // 1. If it has children, it's likely a project (or a note with sub-notes, but we treat structure as project-like)
      if (hasChildrenMap.get(note._id)) return true;
      
      // 2. If it has no content and no children, it's ambiguous. 
      // But if we are in "only notes" mode, we might want to hide it if we suspect it's a folder.
      // However, a new empty note also looks like this.
      // Let's rely on content check for ambiguous cases.
      const raw = typeof note.content === 'string' ? note.content : '';
      const text = raw.replace(/<[^>]*>/g, '').trim();
      
      // If content is empty and type is unknown, assume project/folder to be safe and hide it from note list
      if (text.length === 0) return true;
      
      return false;
    };

    return notes.filter((n) => !isProjectLike(n));
  }, [notes]);
  const noteById = useMemo(() => new Map(visibleNotes.map((note) => [note._id, note])), [visibleNotes]);

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
    const buildTree = (parentId: string | null = null, level = 0, ancestorIds: string[] = []): TreeItem[] => {
      if (level > 15) return [];
      // Find items that match the parentId
      // For root (parentId === null), also include items whose parents are missing from the visible set (orphans)
      const isRoot = parentId === null;
      const ancestorSet = new Set(ancestorIds);
      
      return visibleNotes
        .filter(n => {
            if (ancestorSet.has(n._id)) return false;
            if (isRoot) {
                // If it's a root item
                if (!n.parentId) return true;
                // Or if its parent is NOT in the visible notes (orphan)
                const parentExists = visibleNotes.some(p => p._id === n.parentId);
                return !parentExists;
            }
            return n.parentId === parentId;
        })
        .sort((a, b) => {
          const dir = sortOrder === 'desc' ? -1 : 1;

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
        })
        .flatMap(note => {
          const children = visibleNotes.filter(n => n.parentId === note._id);
          const hasChildren = children.length > 0;
          const isExpanded = expandedIds.has(note._id);
          
          const item: TreeItem = {
            ...note,
            level,
            hasChildren,
            isExpanded
          };

          if (hasChildren && isExpanded) {
            return [item, ...buildTree(note._id, level + 1, [...ancestorIds, note._id])];
          }
          return [item];
        });
    };

    return buildTree(null);
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
  const isDescendantOf = useCallback(
    (candidateId: string, ancestorId: string) => {
      let currentId: string | null = candidateId;
      let depth = 0;
      while (currentId && depth < 500) {
        if (currentId === ancestorId) return true;
        const current = noteById.get(currentId);
        currentId = current?.parentId ?? null;
        depth += 1;
      }
      return false;
    },
    [noteById]
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
    (item: TreeItem, drag?: () => void, isActive?: boolean) => (
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
                const iconColor = (item as any).iconColor as string | undefined;
                if (iconKey) {
                  return <FontAwesome5 name={toFa5(iconKey) as any} size={18} color={iconColor || theme.colors.onSurface} />;
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
            {item.tags?.slice(0, 3).map((tag, index) => (
              <Chip key={`${item._id}-${index}`} style={styles.chip} textStyle={{ fontSize: 10 }}>
                {tag}
              </Chip>
            ))}
          </View>
        </Card.Content>
      </Card>
    ),
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
          newParentId = prevItem.parentId;
        }
      }
      if (newParentId && !noteById.has(newParentId)) {
        newParentId = null;
      }
      if (newParentId && isDescendantOf(newParentId, movedItem._id)) {
        newParentId = null;
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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            draggedItemRef.current = treeData[index];
          }}
          refreshing={refreshing}
          onRefresh={onRefresh}
          contentContainerStyle={variant === 'cards' ? styles.listContent : undefined}
        />
      ) : (
        <FlashList
          data={treeData}
          renderItem={({ item }) => (variant === 'cards' ? renderCardRow(item) : renderCompactRow(item))}
          keyExtractor={(item) => item._id}
          onRefresh={onRefresh}
          refreshing={refreshing}
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
