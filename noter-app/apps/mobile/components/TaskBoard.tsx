import React from 'react';
import { View, StyleSheet, ScrollView, Text, Dimensions, TouchableOpacity } from 'react-native';
import { Task } from '@repo/shared';
import { useTheme, Card, Checkbox, IconButton } from 'react-native-paper';

interface TaskBoardProps {
  tasks: Task[];
  onTaskPress: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
}

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width * 0.85;

export const TaskBoard: React.FC<TaskBoardProps> = ({ tasks, onTaskPress, onToggleComplete }) => {
    const theme = useTheme();
    const activeTasks = tasks.filter(t => !t.completed);
    const completedTasks = tasks.filter(t => t.completed);

    const renderColumn = (title: string, columnTasks: Task[], status: 'active' | 'completed') => (
        <View style={[styles.column, { backgroundColor: theme.colors.surfaceVariant, width: COLUMN_WIDTH }]}>
            <Text style={[styles.columnTitle, { color: theme.colors.onSurfaceVariant }]}>{title} ({columnTasks.length})</Text>
            <ScrollView style={styles.columnList}>
                {columnTasks.map(task => (
                    <Card key={task._id} style={styles.card} onPress={() => onTaskPress(task)}>
                        <Card.Content style={styles.cardContent}>
                            <View style={styles.cardHeader}>
                                <Text style={[styles.cardTitle, { color: theme.colors.onSurface, textDecorationLine: task.completed ? 'line-through' : 'none' }]}>
                                    {task.title}
                                </Text>
                                <Checkbox 
                                    status={task.completed ? 'checked' : 'unchecked'} 
                                    onPress={() => onToggleComplete(task)}
                                />
                            </View>
                            {task.dueDate && (
                                <Text style={{ color: theme.colors.secondary, fontSize: 12, marginTop: 4 }}>
                                    {new Date(task.dueDate).toLocaleDateString()}
                                </Text>
                            )}
                             <View style={[styles.priorityBadge, { 
                                borderColor: task.priority === 'high' ? theme.colors.error : task.priority === 'medium' ? theme.colors.tertiary : theme.colors.primary 
                            }]}>
                                <Text style={{ 
                                    fontSize: 10, 
                                    color: task.priority === 'high' ? theme.colors.error : task.priority === 'medium' ? theme.colors.tertiary : theme.colors.primary 
                                }}>
                                    {(task.priority ?? 'medium').toUpperCase()}
                                </Text>
                            </View>
                        </Card.Content>
                    </Card>
                ))}
            </ScrollView>
        </View>
    );

    return (
        <ScrollView horizontal pagingEnabled snapToInterval={COLUMN_WIDTH + 16} contentContainerStyle={styles.container} showsHorizontalScrollIndicator={false}>
            {renderColumn('To Do', activeTasks, 'active')}
            {renderColumn('Completed', completedTasks, 'completed')}
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
    columnList: {
        flex: 1,
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
