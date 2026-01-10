import React, { useCallback, useState } from 'react';
import { StyleSheet, View, RefreshControl, TouchableOpacity } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams, ShadowDecorator, OpacityDecorator } from 'react-native-draggable-flatlist';
import { Text, Checkbox, TouchableRipple, useTheme, Chip, IconButton, SegmentedButtons, Menu, Divider } from 'react-native-paper';
import { Task } from '@repo/shared';
import { useRouter } from 'expo-router';
import { orderBy } from 'lodash';
import { TaskBoard } from './TaskBoard';
import { TaskTimeline } from './TaskTimeline';

interface TaskListProps {
  tasks: Task[];
  onRefresh?: () => void;
  refreshing?: boolean;
  onToggleComplete: (task: Task) => void;
  onReorder?: (tasks: Task[]) => void;
  showViewToggle?: boolean;
  onCreateTask?: (date: Date) => void;
}

export default function TaskList({ tasks, onRefresh, refreshing, onToggleComplete, onReorder, showViewToggle = true, onCreateTask }: TaskListProps) {
  const theme = useTheme();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<string>('list');
  const [sortBy, setSortBy] = useState<'custom' | 'createdAt' | 'dueDate' | 'priority'>('custom');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);

  const getSortedTasks = useCallback(() => {
    let sorted = [...tasks];
    
    if (sortBy === 'priority') {
      const priorityRank = (t: Task) => {
        if (t.priority === 'high') return 0;
        if (t.priority === 'medium') return 1;
        if (t.priority === 'low') return 2;
        return 1;
      };
      // Sort by: Completed (asc), Priority (asc -> high to low rank), CreatedAt (desc)
      sorted = orderBy(sorted, ['completed', priorityRank, 'createdAt'], ['asc', 'asc', 'desc']);
    } else if (sortBy === 'createdAt') {
      sorted = orderBy(sorted, ['completed', 'createdAt'], ['asc', 'desc']);
    } else if (sortBy === 'dueDate') {
      sorted = orderBy(sorted, ['completed', 'dueDate'], ['asc', 'asc']);
    }
    
    return sorted;
  }, [tasks, sortBy]);

  const sortedTasks = getSortedTasks();
  const isCustomSort = sortBy === 'custom';

  const handlePress = (task: Task) => {
    router.push(`/task/${task._id}`);
  };

  const renderItem = useCallback(({ item, drag, isActive }: RenderItemParams<Task>) => {
    const priorityColor = 
      item.priority === 'high' ? theme.colors.error :
      item.priority === 'medium' ? theme.colors.primary :
      theme.colors.primary;

    return (
      <ScaleDecorator>
        <OpacityDecorator>
          <ShadowDecorator>
            <TouchableRipple 
              key={item._id} // Ensure explicit key is set
              onPress={() => handlePress(item)} 
              onLongPress={drag} 
              disabled={isActive}
              style={[
                styles.itemContainer, 
                { backgroundColor: isActive ? theme.colors.elevation.level3 : theme.colors.elevation.level1 }
              ]}
            >
              <View style={styles.itemRow}>
                <Checkbox
                  status={item.completed ? 'checked' : 'unchecked'}
                  onPress={() => onToggleComplete(item)}
                />
                <View style={styles.contentContainer}>
                  <Text 
                    variant="bodyLarge" 
                    style={[
                      styles.title, 
                      item.completed && { textDecorationLine: 'line-through', color: theme.colors.onSurfaceDisabled }
                    ]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.description ? (
                     <Text 
                      variant="bodySmall" 
                      style={[
                        styles.description,
                        item.completed && { color: theme.colors.onSurfaceDisabled }
                      ]}
                      numberOfLines={1}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                  <View style={styles.metaContainer}>
                    <Chip 
                      textStyle={{ fontSize: 10, lineHeight: 10, marginVertical: 2, marginHorizontal: 4 }} 
                      style={[styles.chip, { borderColor: priorityColor }]} 
                      mode="outlined"
                      compact
                    >
                      {item.priority}
                    </Chip>
                    {item.dueDate && (
                      <Text variant="labelSmall" style={styles.date}>
                        {(() => {
                          const d = new Date(item.dueDate as any);
                          const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
                          return hasTime
                            ? `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
                            : d.toLocaleDateString();
                        })()}
                      </Text>
                    )}
                  </View>
                </View>
                {onReorder && isCustomSort && (
                  <TouchableOpacity onPressIn={drag} style={styles.dragHandle}>
                    <IconButton icon="drag-vertical" size={20} />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableRipple>
          </ShadowDecorator>
        </OpacityDecorator>
      </ScaleDecorator>
    );
  }, [theme, onToggleComplete, onReorder, isCustomSort]);

  return (
    <View style={{ flex: 1 }}>
        <View style={styles.headerContainer}>
            {showViewToggle && (
                <SegmentedButtons
                    value={viewMode}
                    onValueChange={setViewMode}
                    buttons={[
                        { value: 'list', label: 'List', icon: 'format-list-bulleted' },
                        { value: 'board', label: 'Board', icon: 'view-column' },
                        { value: 'calendar', label: 'Calendar', icon: 'calendar' },
                    ]}
                    style={{ flex: 1 }}
                />
            )}
            
            {/* Sort menu removed as it is now in the header */}
        </View>

        {viewMode === 'list' && (
            <DraggableFlatList
                data={sortedTasks}
                onDragEnd={({ data }) => {
                    if (isCustomSort) {
                        onReorder?.(data);
                    }
                }}
                keyExtractor={(item) => item._id}
                renderItem={renderItem}
                contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} />
                }
            />
        )}

        {viewMode === 'board' && (
            <TaskBoard 
                tasks={tasks} 
                onTaskPress={handlePress} 
                onToggleComplete={onToggleComplete}
            />
        )}

        {viewMode === 'calendar' && (
            <TaskTimeline 
                tasks={tasks} 
                onTaskPress={handlePress} 
                onCreateTask={onCreateTask}
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
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  listContent: {
    flex: 1,
  },
  itemContainer: {
    marginBottom: 12,
    marginHorizontal: 16, // Moved margin here since containerStyle is different in DraggableFlatList
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 1,
    padding: 8,
    marginTop: 1, // Fix for shadow clipping
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dragHandle: {
    marginRight: -8,
  },
  contentContainer: {
    flex: 1,
    marginLeft: 8,
  },
  title: {
    fontWeight: '600',
  },
  description: {
    // opacity: 0.7, // Removed for high contrast
  },
  metaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  chip: {
    height: 20,
    backgroundColor: 'transparent',
  },
  date: {
    opacity: 0.6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    opacity: 0.5,
  },
});
