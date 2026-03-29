import React, { useCallback, useState } from 'react';
import { StyleSheet, View, RefreshControl } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams, ShadowDecorator, OpacityDecorator } from 'react-native-draggable-flatlist';
import { SegmentedButtons } from 'react-native-paper';
import { Task } from '@repo/shared';
import { useRouter } from 'expo-router';
import { orderBy } from 'lodash';
import * as Haptics from 'expo-haptics';
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
  const router = useRouter();
  const [viewMode, setViewMode] = useState<string>('list');
  const [sortBy, setSortBy] = useState<'custom' | 'createdAt' | 'dueDate' | 'priority'>('custom');

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

  const handlePress = useCallback((task: Task) => {
    router.push(`/task/${task._id}`);
  }, [router]);

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
  }, [handlePress, onDelete, onReorder, onToggleComplete, isCustomSort]);

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
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
                    refreshControl={
                        <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} />
                    }
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
