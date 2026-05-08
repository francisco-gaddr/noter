import React from 'react';
import { StyleSheet, View, TouchableOpacity, Animated } from 'react-native';
import { Text, Checkbox, TouchableRipple, useTheme, Chip, IconButton } from 'react-native-paper';
import { Task } from '@repo/shared';
import * as Haptics from 'expo-haptics';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { formatTaskDueLabel } from '@/utils/date';
import { useTranslation } from 'react-i18next';

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

export const TaskItem: React.FC<TaskItemProps> = React.memo(({
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
  const { t, i18n } = useTranslation();
  const safeTitle = typeof task.title === 'string' && task.title.trim().length > 0
    ? task.title.trim()
    : t('common.untitled');
  const safeDescription = typeof task.description === 'string'
    ? task.description.trim()
    : '';
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
          <Text style={{ color: 'white', fontWeight: 'bold' }}>{t('common.delete')}</Text>
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
        onPress={() => onPress(task)}
          onLongPress={handleLongPress}
        disabled={disabled}
        style={[
          styles.itemContainer,
          { backgroundColor: isActive ? theme.colors.elevation.level3 : theme.colors.elevation.level1 }
        ]}
      >
        <View style={styles.itemRow}>
          {showDragHandle ? (
            <IconButton icon="drag" size={18} style={styles.dragHandle} />
          ) : null}
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
              {safeTitle}
            </Text>
            {safeDescription ? (
              <Text
                variant="bodySmall"
                style={[
                  styles.description,
                  task.completed && { color: theme.colors.onSurfaceDisabled }
                ]}
                numberOfLines={1}
              >
                {safeDescription}
              </Text>
            ) : null}
            <View style={styles.metaContainer}>
              <Chip
                textStyle={{ fontSize: 10, lineHeight: 12, marginVertical: 0, marginHorizontal: 4 }}
                style={[styles.chip, { borderColor: priorityColor }]}
                mode="outlined"
                compact
              >
                {task.priority === 'low' ? t('tasks.priorityLow') : 
                 task.priority === 'medium' ? t('tasks.priorityMedium') : 
                 task.priority === 'high' ? t('tasks.priorityHigh') : 
                 task.priority}
              </Chip>
              {task.dueDate && (
                <Text variant="labelSmall" style={styles.date}>
                  {(() => {
                    const d = new Date(task.dueDate as any);
                    if (isNaN(d.getTime())) return '';
                    const label = formatTaskDueLabel(d, {
                      locale: i18n.language?.toLowerCase().startsWith('sv') ? 'sv-SE' : 'en-US',
                      todayLabel: t('common.today'),
                      tomorrowLabel: t('common.tomorrow'),
                      yesterdayLabel: t('common.yesterday'),
                      dayBeforeYesterdayLabel: t('common.dayBeforeYesterday'),
                      timePrefix: t('common.timeAt'),
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
});

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
    minHeight: 20,
    backgroundColor: 'transparent',
    paddingVertical: 0,
    justifyContent: 'center',
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
