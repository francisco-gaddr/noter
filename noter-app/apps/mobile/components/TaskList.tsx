import React, { useCallback, useState } from 'react';
import { StyleSheet, View, RefreshControl, TouchableOpacity, Animated } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams, ShadowDecorator, OpacityDecorator } from 'react-native-draggable-flatlist';
import { FlashList } from '@shopify/flash-list';
import { Text, Checkbox, TouchableRipple, useTheme, Chip, IconButton, SegmentedButtons, Menu, Divider } from 'react-native-paper';
import { Task, priorityRank } from '@repo/shared';
import { useRouter } from 'expo-router';
import { orderBy } from 'lodash';
import * as Haptics from 'expo-haptics';
import Swipeable from 'react-native-gesture-handler/Swipeable';
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
  onDelete?: (task: Task) => void;
  scrollEnabled?: boolean;
}

import { TaskItem } from './TaskItem';

export default function TaskList({ tasks, onRefresh, refreshing, onToggleComplete, onReorder, showViewToggle = true, onCreateTask, onDelete, scrollEnabled = true }: TaskListProps) {
  const theme = useTheme();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<string>('list');
  const [sortBy, setSortBy] = useState<'custom' | 'createdAt' | 'dueDate' | 'priority'>('custom');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);

  const getSortedTasks = useCallback(() => {
    let sorted = [...tasks];
    
    if (sortBy === 'priority') {
      // Sort by: Completed (asc), Priority (asc -> high to low rank), CreatedAt (desc)
      sorted = orderBy(sorted, ['completed', (t: Task) => priorityRank(t.priority), 'createdAt'], ['asc', 'asc', 'desc']);
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
    return (
      <ScaleDecorator>
        <OpacityDecorator>
          <ShadowDecorator>
            <TaskItem 
                task={item}
                onToggleComplete={onToggleComplete}
                onDelete={onDelete}
                onPress={handlePress}
                onLongPress={() => {
                   if (isCustomSort) {
                       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                       drag();
                   }
                }}
                disabled={isActive}
                isActive={isActive}
                showDragHandle={!!onReorder && isCustomSort}
                onDragStart={drag}
            />
          </ShadowDecorator>
        </OpacityDecorator>
      </ScaleDecorator>
    );
  }, [theme, onToggleComplete, onReorder, isCustomSort, onDelete]);

  // Drag-free row for the FlashList (pull-to-refresh) path. Long-press still opens the task.
  const renderRow = useCallback((item: Task) => (
    <TaskItem
      task={item}
      onToggleComplete={onToggleComplete}
      onDelete={onDelete}
      onPress={handlePress}
      disabled={false}
      isActive={false}
      showDragHandle={false}
    />
  ), [onToggleComplete, onDelete]);

  if (!scrollEnabled && viewMode === 'list') {
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
            </View>
            <View>
                {sortedTasks.map((item) => (
                    <View key={item._id}>
                        <TaskItem 
                            task={item}
                            onToggleComplete={onToggleComplete}
                            onDelete={onDelete}
                            onPress={handlePress}
                            showDragHandle={false}
                        />
                    </View>
                ))}
            </View>
        </View>
      );
  }

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
            !scrollEnabled ? (
                <View style={{ paddingTop: 12, paddingBottom: 100 }}>
                    {sortedTasks.map(task => (
                        <View key={task._id}>
                             <TaskItem 
                                task={task}
                                onToggleComplete={onToggleComplete}
                                onDelete={onDelete}
                                onPress={handlePress}
                                disabled={false}
                                isActive={false}
                                showDragHandle={false}
                            />
                        </View>
                    ))}
                </View>
            ) : onRefresh ? (
                // FlashList for reliable pull-to-refresh (DraggableFlatList's pan swallows it).
                // Empty area + offset so the gesture works even in an empty list.
                <FlashList
                    data={sortedTasks}
                    keyExtractor={(item) => item._id}
                    renderItem={({ item }) => renderRow(item)}
                    onRefresh={onRefresh}
                    refreshing={!!refreshing}
                    progressViewOffset={8}
                    ListEmptyComponent={<View style={{ minHeight: 500 }} />}
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
                />
            ) : (
                <DraggableFlatList
                    data={sortedTasks}
                    onDragEnd={({ data }) => {
                        if (isCustomSort) {
                            onReorder?.(data);
                        }
                    }}
                    keyExtractor={(item) => item._id}
                    renderItem={renderItem}
                    activationDistance={16}
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
                />
            )
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
  deleteAction: {
    backgroundColor: '#dd2c00',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: 12,
    marginTop: 1,
    marginRight: 16, // Match itemContainer margin
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    width: 80,
  },
  deleteActionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
});
