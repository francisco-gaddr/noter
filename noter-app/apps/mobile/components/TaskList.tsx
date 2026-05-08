import React, { useCallback, useState } from 'react';
import { StyleSheet, View, RefreshControl } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams, ShadowDecorator, OpacityDecorator } from 'react-native-draggable-flatlist';
import { FlashList } from '@shopify/flash-list';
import { SegmentedButtons } from 'react-native-paper';
import { Task } from '@repo/shared';
import { useRouter } from 'expo-router';
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
  const displayTasks = tasks;
  const canReorder = Boolean(onReorder);

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
                   if (canReorder) {
                       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                       drag();
                   }
                }}
                disabled={isActive}
                isActive={isActive}
                showDragHandle={canReorder}
                onDragStart={drag}
            />
          </ShadowDecorator>
        </OpacityDecorator>
      </ScaleDecorator>
    );
  }, [canReorder, handlePress, onDelete, onToggleComplete]);

  const renderStaticTask = useCallback(({ item }: { item: Task }) => (
    <TaskItem
      task={item}
      onToggleComplete={onToggleComplete}
      onDelete={onDelete}
      onPress={handlePress}
      disabled={false}
      isActive={false}
      showDragHandle={false}
    />
  ), [handlePress, onDelete, onToggleComplete]);

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
            <FlashList
                data={displayTasks}
                renderItem={renderStaticTask}
                keyExtractor={(item) => item._id}
                contentContainerStyle={{ paddingBottom: 24 }}
            />
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
                <FlashList
                    data={displayTasks}
                    renderItem={renderStaticTask}
                    keyExtractor={(item) => item._id}
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
                />
            ) : (
                <DraggableFlatList
                    data={displayTasks}
                    onDragEnd={({ data }) => {
                        if (canReorder) {
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
                tasks={displayTasks} 
                onTaskPress={handlePress} 
                onToggleComplete={onToggleComplete}
            />
        )}

        {viewMode === 'calendar' && (
            <TaskTimeline 
                tasks={displayTasks} 
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
