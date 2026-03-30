import React from 'react';
import { View, StyleSheet, ScrollView, Text, Dimensions } from 'react-native';
import { Task } from '@repo/shared';
import { useTheme, Card, Checkbox } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { formatTaskDueLabel } from '@/utils/date';

interface TaskBoardProps {
  tasks: Task[];
  onTaskPress: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
}

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width * 0.85;

const TaskBoardCard = React.memo(function TaskBoardCard({
    task,
    onTaskPress,
    onToggleComplete,
    colors,
}: {
    task: Task;
    onTaskPress: (task: Task) => void;
    onToggleComplete: (task: Task) => void;
    colors: any;
}) {
    return (
        <Card style={styles.card} onPress={() => onTaskPress(task)}>
            <Card.Content style={styles.cardContent}>
                <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { color: colors.onSurface, textDecorationLine: task.completed ? 'line-through' : 'none' }]}>
                        {task.title}
                    </Text>
                    <Checkbox
                        status={task.completed ? 'checked' : 'unchecked'}
                        onPress={() => onToggleComplete(task)}
                    />
                </View>
                {task.dueDate && (
                    <Text style={{ color: colors.secondary, fontSize: 12, marginTop: 4 }}>
                        {(() => {
                          const d = new Date(task.dueDate as any);
                          if (isNaN(d.getTime())) return '';
                          const label = formatTaskDueLabel(d, {
                            locale: 'sv-SE',
                            todayLabel: 'Idag',
                            tomorrowLabel: 'Imorgon',
                            yesterdayLabel: 'Igår',
                            dayBeforeYesterdayLabel: 'I förrgår',
                            timePrefix: 'kl',
                          });
                          return `${task.reminderEnabled ? '⏰ ' : ''}${label}`;
                        })()}
                    </Text>
                )}
                 <View style={[styles.priorityBadge, {
                    borderColor: task.priority === 'high' ? colors.error : task.priority === 'medium' ? colors.tertiary : colors.primary
                }]}>
                    <Text style={{
                        fontSize: 10,
                        color: task.priority === 'high' ? colors.error : task.priority === 'medium' ? colors.tertiary : colors.primary
                    }}>
                        {(task.priority ?? 'medium').toUpperCase()}
                    </Text>
                </View>
            </Card.Content>
        </Card>
    );
});

export const TaskBoard: React.FC<TaskBoardProps> = ({ tasks, onTaskPress, onToggleComplete }) => {
    const theme = useTheme();
    const activeTasks = tasks.filter(t => !t.completed);
    const completedTasks = tasks.filter(t => t.completed);

    const renderColumn = (title: string, columnTasks: Task[]) => (
        <View style={[styles.column, { backgroundColor: theme.colors.surfaceVariant, width: COLUMN_WIDTH }]}>
            <Text style={[styles.columnTitle, { color: theme.colors.onSurfaceVariant }]}>{title} ({columnTasks.length})</Text>
            <FlashList
                data={columnTasks}
                renderItem={({ item }) => (
                    <TaskBoardCard
                        task={item}
                        onTaskPress={onTaskPress}
                        onToggleComplete={onToggleComplete}
                        colors={theme.colors}
                    />
                )}
                keyExtractor={(item) => item._id}
                contentContainerStyle={styles.columnListContent}
            />
        </View>
    );

    return (
        <ScrollView horizontal pagingEnabled snapToInterval={COLUMN_WIDTH + 16} contentContainerStyle={styles.container} showsHorizontalScrollIndicator={false}>
            {renderColumn('To Do', activeTasks)}
            {renderColumn('Completed', completedTasks)}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 8,
    },
    column: {
        borderRadius: 8,
        padding: 8,
        marginRight: 16,
        height: '100%',
    },
    columnTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
        marginLeft: 4,
    },
    columnListContent: {
        paddingBottom: 12,
    },
    card: {
        marginBottom: 8,
    },
    cardContent: {
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 16,
        flex: 1,
        marginRight: 8,
    },
    priorityBadge: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 2,
        marginTop: 8
    }
});
