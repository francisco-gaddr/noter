import React from 'react';
import { Task } from '@repo/shared';
import { useTranslation } from 'react-i18next';
import { FaBell, FaCheckCircle, FaRegCircle } from 'react-icons/fa';
import { useDrag, useDrop } from 'react-dnd';
import { formatTaskDueLabel } from '../lib/formatTaskDue';

interface TaskBoardProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    onStatusChange: (task: Task, completed: boolean) => void;
}

const DraggableTaskCard = ({ task, onClick, onStatusChange }: { task: Task, onClick: (t: Task) => void, onStatusChange: (t: Task, c: boolean) => void }) => {
    const [{ isDragging }, drag] = useDrag({
        type: 'BOARD_TASK',
        item: { id: task._id, completed: task.completed },
        collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
    });

    return (
        <div 
            ref={drag as unknown as React.LegacyRef<HTMLDivElement>}
            className={`bg-white dark:bg-gray-800 p-3 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer group ${isDragging ? 'opacity-50' : ''}`}
            onClick={() => onClick(task)}
        >
            <div className="flex items-start gap-3">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onStatusChange(task, !task.completed);
                    }}
                    className={`mt-1 ${task.completed ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}
                >
                    {task.completed ? <FaCheckCircle /> : <FaRegCircle />}
                </button>
                <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium truncate ${task.completed ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                        {task.title}
                    </h4>
                    {task.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                            {task.description}
                        </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            task.priority === 'high' ? 'border-red-200 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800' :
                            task.priority === 'medium' ? 'border-yellow-200 text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800' :
                            'border-green-200 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                        }`}>
                            {task.priority.toUpperCase()}
                        </span>
                        {task.dueDate && (() => {
                            const d = new Date(task.dueDate);
                            if (isNaN(d.getTime())) return null;
                            const locale = typeof navigator !== 'undefined' ? navigator.language : 'sv-SE';
                            return (
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                    {task.reminderEnabled ? <FaBell size={10} /> : null}
                                    {formatTaskDueLabel(d, {
                                        locale,
                                        todayLabel: 'Idag',
                                        tomorrowLabel: 'Imorgon',
                                        yesterdayLabel: 'Igår',
                                        timePrefix: 'kl',
                                    })}
                                </span>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DroppableColumn = ({ title, tasks, status, onTaskClick, onStatusChange, onDrop }: { title: string, tasks: Task[], status: 'todo' | 'completed', onTaskClick: (t: Task) => void, onStatusChange: (t: Task, c: boolean) => void, onDrop: (id: string, s: 'todo' | 'completed') => void }) => {
    const [{ isOver }, drop] = useDrop({
        accept: 'BOARD_TASK',
        drop: (item: { id: string }) => onDrop(item.id, status),
        collect: (monitor) => ({ isOver: !!monitor.isOver() })
    });

    return (
        <div ref={drop as unknown as React.LegacyRef<HTMLDivElement>} className={`flex-1 min-w-[300px] bg-gray-50 dark:bg-gray-900 rounded-lg p-4 flex flex-col h-full transition-colors ${isOver ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/20' : ''}`}>
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center justify-between">
                {title}
                <span className="text-sm font-normal bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-300">
                    {tasks.length}
                </span>
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3">
                {tasks.map(task => (
                    <DraggableTaskCard 
                        key={task._id} 
                        task={task} 
                        onClick={onTaskClick} 
                        onStatusChange={onStatusChange} 
                    />
                ))}
            </div>
        </div>
    );
};

export default function TaskBoard({ tasks, onTaskClick, onStatusChange }: TaskBoardProps) {
    const { t } = useTranslation();
    const todoTasks = tasks.filter(t => !t.completed);
    const completedTasks = tasks.filter(t => t.completed);

    const handleDrop = (taskId: string, targetStatus: 'todo' | 'completed') => {
        const task = tasks.find(t => t._id === taskId);
        if (task) {
            const isCompleted = targetStatus === 'completed';
            if (task.completed !== isCompleted) {
                onStatusChange(task, isCompleted);
            }
        }
    };

    return (
        <div className="flex h-full gap-4 overflow-x-auto p-2">
            <DroppableColumn 
                title={t('tasks.todo') || 'To Do'} 
                tasks={todoTasks} 
                status="todo" 
                onTaskClick={onTaskClick} 
                onStatusChange={onStatusChange}
                onDrop={handleDrop}
            />
            <DroppableColumn 
                title={t('tasks.completed') || 'Completed'} 
                tasks={completedTasks} 
                status="completed" 
                onTaskClick={onTaskClick} 
                onStatusChange={onStatusChange}
                onDrop={handleDrop}
            />
        </div>
    );
}
