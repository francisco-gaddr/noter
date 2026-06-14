import React from 'react';
import { StyleSheet, View, TouchableOpacity, Animated } from 'react-native';
import { Text, Checkbox, TouchableRipple, useTheme, Chip, IconButton } from 'react-native-paper';
import { Task } from '@repo/shared';
import * as Haptics from 'expo-haptics';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { formatTaskDueLabel } from '@/utils/date';

interface TaskItemProps {
  task: Task;
  onToggleComplete: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onPress: (task: Task) => void;
  onLongPress?: () => void;
  onDragStart?: () => void;
  disabled?: boolean;
  isActive?: boolean;
  showDragHandle?: boolean;
}

const TaskItemComponent: React.FC<TaskItemProps> = ({
  task,
  onToggleComplete,
  onDelete,
  onPress,
  onLongPress,
  onDragStart,
  disabled,
  isActive,
  showDragHandle,
}) => {
  const theme = useTheme();
  const handleLongPress = () => {
    onLongPress?.();
    onDragStart?.();
  };

  const renderRightActions = (progress: any, dragX: any) => {
    const scale = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });

    return (
      <TouchableOpacity
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete?.(task);
        }}
        style={styles.deleteAction}
      >
        <Animated.View style={[styles.deleteActionContent, { transform: [{ scale }] }]}>
          <IconButton icon="delete" iconColor="white" size={24} />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Delete</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const priorityColor =
    task.priority === 'high' ? theme.colors.error :
    task.priority === 'medium' ? theme.colors.primary :
    theme.colors.primary;

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight={false}
    >
      <TouchableRipple
        onPress={() => {
          Haptics.selectionAsync();
          onPress(task);
        }}
        onLongPress={handleLongPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Task: ${task.title || 'Untitled'}${task.completed ? ', completed' : ''}${task.priority ? `, priority ${task.priority}` : ''}`}
        accessibilityHint="Double-tap to open. Swipe right to delete."
        accessibilityState={{ checked: !!task.completed, disabled: !!disabled }}
        style={[
          styles.itemContainer,
          { backgroundColor: isActive ? theme.colors.elevation.level3 : theme.colors.elevation.level1 }
        ]}
      >
        <View style={styles.itemRow}>
          {showDragHandle ? (
            <IconButton icon="drag" size={18} style={styles.dragHandle} />
          ) : null}
          {/*
            Paper's Checkbox typings don't expose accessibilityLabel directly,
            but the outer TouchableRipple already carries accessibilityRole=
            "button" + accessibilityState.checked, so the screen reader has the
            full meaning. The checkbox itself reads "selected/not selected" via
            its native role.
          */}
          <Checkbox
            status={task.completed ? 'checked' : 'unchecked'}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onToggleComplete(task);
            }}
          />
          <View style={styles.contentContainer}>
            <Text
              variant="bodyLarge"
              style={[
                styles.title,
                task.completed && { textDecorationLine: 'line-through', color: theme.colors.onSurfaceDisabled }
              ]}
              numberOfLines={1}
            >
              {task.title}
            </Text>
            {task.description ? (
              <Text
                variant="bodySmall"
                style={[
                  styles.description,
                  task.completed && { color: theme.colors.onSurfaceDisabled }
                ]}
                numberOfLines={1}
              >
                {task.description}
              </Text>
            ) : null}
            <View style={styles.metaContainer}>
              <Chip
                textStyle={{ fontSize: 10, lineHeight: 10, marginVertical: 2, marginHorizontal: 4 }}
                style={[styles.chip, { borderColor: priorityColor }]}
                mode="outlined"
                compact
              >
                {task.priority}
              </Chip>
              {task.dueDate && (
                <Text variant="labelSmall" style={styles.date}>
                  {(() => {
                    const d = new Date(task.dueDate as any);
                    if (isNaN(d.getTime())) return '';
                    const label = formatTaskDueLabel(d, {
                      locale: 'sv-SE',
                      todayLabel: 'Idag',
                      tomorrowLabel: 'Imorgon',
                      yesterdayLabel: 'Igår',
                      timePrefix: 'kl',
                    });
                    return `${task.reminderEnabled ? '⏰ ' : ''}${label}`;
                  })()}
                </Text>
              )}
            </View>
          </View>
        </View>
      </TouchableRipple>
    </Swipeable>
  );
};

// Memoized so a task row only re-renders when its own task/handlers change, not
// on every list re-render (e.g. switching the selected list or toggling another
// task) — a major source of mobile list jank.
export const TaskItem = React.memo(TaskItemComponent);
TaskItem.displayName = 'TaskItem';

const styles = StyleSheet.create({
  itemContainer: {
    marginBottom: 12,
    marginHorizontal: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 1,
    padding: 8,
    marginTop: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contentContainer: {
    flex: 1,
    marginLeft: 8,
  },
  title: {
    fontWeight: '600',
  },
  description: {
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
  dragHandle: {
    marginRight: -8,
  },
  deleteAction: {
    backgroundColor: '#dd2c00',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: 12,
    marginTop: 1,
    marginRight: 16,
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
