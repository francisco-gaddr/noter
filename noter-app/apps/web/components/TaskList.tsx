'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../stores/useStore';
import { Task } from '@repo/shared';
import { FaPlus, FaTrash, FaCheckCircle, FaRegCircle, FaExclamationCircle, FaSort, FaBars, FaList, FaColumns, FaCalendar, FaFilter, FaBell } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { TaskDetailModal } from './TaskDetailModal';
import TaskBoard from './TaskBoard';
import TaskCalendar from './TaskCalendar';
import { useDrag, useDrop, type DragSourceMonitor, type DropTargetMonitor } from 'react-dnd';
import { debounce, orderBy } from 'lodash';
import { startOfDay, endOfDay, isWithinInterval, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, isValid } from 'date-fns';
import type { Identifier, XYCoord } from 'dnd-core';
import Fuse from 'fuse.js';
import { formatTaskDueLabel } from '../lib/formatTaskDue';
import { createCalendarSubscription, getCalendarUrl, revokeCalendarSubscription } from '../lib/calendarSubscription';

const ItemType = 'TASK';

type DragItem = { id: string; index: number };

interface TaskItemProps {
    task: Task;
    index: number;
    moveTask: (dragIndex: number, hoverIndex: number) => void;
    onDragEnd: () => void;
    toggleComplete: (task: Task) => void;
    cyclePriority: (task: Task) => void;
    deleteTask: (id: string) => void;
    openTaskDetail: (task: Task) => void;
    getPriorityColor: (priority: string) => string;
    t: (key: string) => string;
    isCustomSort: boolean;
}

const TaskItem: React.FC<TaskItemProps> = ({ 
    task, 
    index, 
    moveTask, 
    onDragEnd,
    toggleComplete, 
    cyclePriority, 
    deleteTask, 
    openTaskDetail, 
    getPriorityColor, 
    t,
    isCustomSort
}) => {
    const ref = useRef<HTMLDivElement>(null);

    const [{ handlerId }, drop] = useDrop<DragItem, void, { handlerId: Identifier | null }>({
        accept: ItemType,
        collect(monitor: DropTargetMonitor) {
            return {
                handlerId: monitor.getHandlerId(),
            };
        },
        hover(item: DragItem, monitor: DropTargetMonitor) {
            if (!ref.current) {
                return;
            }
            const dragIndex = item.index;
            const hoverIndex = index;

            // Don't replace items with themselves
            if (dragIndex === hoverIndex) {
                return;
            }

            // Determine rectangle on screen
            const hoverBoundingRect = ref.current?.getBoundingClientRect();

            // Get vertical middle
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;

            // Determine mouse position
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;

            // Get pixels to the top
            const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;

            // Only perform the move when the mouse has crossed half of the items height
            // When dragging downwards, only move when the cursor is below 50%
            // When dragging upwards, only move when the cursor is above 50%

            // Dragging downwards
            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
                return;
            }

            // Dragging upwards
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
                return;
            }

            // Time to actually perform the action
            moveTask(dragIndex, hoverIndex);

            // Note: we're mutating the monitor item here!
            // Generally it's better to avoid mutations,
            // but it's good here for the sake of performance
            // to avoid expensive index searches.
            item.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
        type: ItemType,
        item: () => {
            return { id: task._id, index };
        },
        collect: (monitor: DragSourceMonitor) => ({
            isDragging: monitor.isDragging(),
        }),
        end: () => {
            onDragEnd();
        },
        canDrag: isCustomSort, // Only allow drag if custom sort is enabled
    });

    // Initialize drag and drop refs
    if (isCustomSort) {
        drag(drop(ref));
    }

    const opacity = isDragging ? 0 : 1;

    return (
        <div 
            ref={ref} 
            style={{ opacity }} 
            data-handler-id={handlerId}
            role="listitem" 
            className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded shadow-sm group"
        >
             {isCustomSort && (
                <div className="cursor-grab text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    <FaBars />
                </div>
            )}

            <button type="button" aria-label={task.completed ? t('aria.markIncomplete') : t('aria.markComplete')} aria-pressed={task.completed} onClick={() => toggleComplete(task)} className="text-gray-400 hover:text-blue-500">
                {task.completed ? <FaCheckCircle className="text-green-500" /> : <FaRegCircle />}
            </button>
            
            <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => openTaskDetail(task)}
            >
                <div
                    className={`text-sm truncate flex gap-2 items-center ${task.completed ? 'line-through text-gray-500 dark:text-gray-300' : ''}`}
                >
                    <span>{task.title}</span>
                    {task.dueDate && (
                        <span className="text-xs text-gray-500 dark:text-gray-300 flex items-center gap-1">
                            {task.reminderEnabled ? <FaBell size={10} /> : <FaCalendar size={10} />}
                            {(() => {
                              const d = new Date(task.dueDate);
                              if (isNaN(d.getTime())) return '';
                              const locale = typeof navigator !== 'undefined' ? navigator.language : 'sv-SE';
                              return formatTaskDueLabel(d, {
                                locale,
                                todayLabel: 'Idag',
                                tomorrowLabel: 'Imorgon',
                                yesterdayLabel: 'Igår',
                                timePrefix: 'kl',
                              });
                            })()}
                        </span>
                    )}
                </div>
                {!!task.description?.trim() && (
                    <div
                        className={`text-xs truncate ${task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                        {task.description}
                    </div>
                )}
            </div>

            <button type="button" aria-label={t('aria.changePriority')} onClick={() => cyclePriority(task)} title={t('aria.changePriority')}>
                <FaExclamationCircle className={getPriorityColor(task.priority)} />
            </button>

            <button 
                type="button"
                aria-label={t('actions.deleteNote')}
                onClick={() => {
                    if (confirm(t('confirm.deleteTask'))) {
                        deleteTask(task._id);
                    }
                }}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"
            >
                <FaTrash size={12} />
            </button>
        </div>
    );
};

export default function TaskList() {
    const { notes, tasks, fetchTasks, createTask, updateTask, deleteTask, reorderTasks, selectedTaskListId, updateNote, isLoading, searchQuery } = useStore();
    const [newTaskTitle, setNewTaskTitle] = useState('');
    // Per-list calendar subscription (copy/deactivate a link for the selected list).
    const [calMsg, setCalMsg] = useState<string | null>(null);
    const [calBusy, setCalBusy] = useState(false);
    const copyListCalendar = useCallback(async () => {
        if (!selectedTaskListId) return;
        setCalBusy(true); setCalMsg(null);
        try {
            let url = getCalendarUrl(selectedTaskListId);
            if (!url) { const sub = await createCalendarSubscription(selectedTaskListId); url = sub.url; }
            if (url) {
                try { await navigator.clipboard.writeText(url); setCalMsg('Kalenderlänk kopierad — klistra in i din kalender (Prenumerera via URL). Endast denna listas daterade uppgifter.'); }
                catch { setCalMsg(url); }
            }
        } catch (e: any) { setCalMsg(e?.message || 'Kunde inte skapa kalenderlänk.'); }
        finally { setCalBusy(false); }
    }, [selectedTaskListId]);
    const revokeListCalendar = useCallback(async () => {
        if (!selectedTaskListId) return;
        await revokeCalendarSubscription(selectedTaskListId);
        setCalMsg('Kalenderlänken för den här listan är inaktiverad.');
    }, [selectedTaskListId]);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newTaskDefaults, setNewTaskDefaults] = useState<{ dueDate: Date | null }>({ dueDate: null });
    const [initialDate, setInitialDate] = useState<Date | null>(null);
    const [sortBy, setSortBy] = useState<'createdAt' | 'custom' | 'dueDate' | 'title' | 'priority'>('custom'); // Default to custom
    const [viewMode, setViewMode] = useState<'list' | 'board' | 'calendar'>('list');
    const [filterDateRange, setFilterDateRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
    const [quickFilter, setQuickFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showFilters, setShowFilters] = useState(false);
    const { t } = useTranslation();

    // Local state for drag and drop to avoid flickering before backend update
    const [localTasks, setLocalTasks] = useState<Task[]>([]);
    const lastSavedOrderKeyRef = useRef<string>('');
    const reorderPendingRef = useRef(false);
    const [listTitle, setListTitle] = useState('');

    // Load persisted settings
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedSort = localStorage.getItem('taskSortBy');
            if (savedSort) setSortBy(savedSort as any);
            
            const savedView = localStorage.getItem('taskViewMode');
            if (savedView) setViewMode(savedView as any);

            const savedFilterRange = localStorage.getItem('taskFilterDateRange');
            if (savedFilterRange) setFilterDateRange(JSON.parse(savedFilterRange));

            const savedQuickFilter = localStorage.getItem('taskQuickFilter');
            if (savedQuickFilter) setQuickFilter(savedQuickFilter);

            const savedStatusFilter = localStorage.getItem('taskStatusFilter');
            if (savedStatusFilter) setStatusFilter(savedStatusFilter as any);
        }
    }, []);

    // Save settings when changed
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('taskSortBy', sortBy);
            localStorage.setItem('taskViewMode', viewMode);
            localStorage.setItem('taskFilterDateRange', JSON.stringify(filterDateRange));
            localStorage.setItem('taskStatusFilter', statusFilter);
            if (quickFilter) localStorage.setItem('taskQuickFilter', quickFilter);
            else localStorage.removeItem('taskQuickFilter');
        }
    }, [sortBy, viewMode, filterDateRange, quickFilter, statusFilter]);

    const selectedList = useMemo(() => {
        if (!selectedTaskListId) return null;
        return notes.find(n => n._id === selectedTaskListId) ?? null;
    }, [notes, selectedTaskListId]);

    const saveListTitle = useMemo(
        () =>
            debounce((id: string, title: string) => {
                updateNote(id, title);
            }, 500),
        [updateNote]
    );

    useEffect(() => {
        if (!selectedList) {
            setListTitle('');
            return;
        }
        setListTitle(selectedList.title || '');
    }, [selectedList]);

    useEffect(() => {
        setLocalTasks([]); // Clear local tasks to prevent blinking old tasks
        fetchTasks(selectedTaskListId || undefined);
    }, [selectedTaskListId, fetchTasks]);

    const openTaskDetail = useCallback((task: Task) => {
        setSelectedTask(task);
        setIsModalOpen(true);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const taskId = params.get('taskId');
        if (!taskId) return;
        const task = tasks.find(t => t._id === taskId);
        if (task) {
            openTaskDetail(task);
            params.delete('taskId');
            const query = params.toString();
            const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
            window.history.replaceState({}, '', nextUrl);
        }
    }, [tasks, openTaskDetail]);

    useEffect(() => {
        let visible = tasks.filter(t => !selectedTaskListId ? true : t.parentNoteId === selectedTaskListId);

        // Apply filters
        if (statusFilter === 'active') {
            visible = visible.filter(t => !t.completed);
        } else if (statusFilter === 'completed') {
            visible = visible.filter(t => t.completed);
        }

        if (quickFilter) {
            const now = new Date();
            const todayStart = startOfDay(now);
            const todayEnd = endOfDay(now);

            visible = visible.filter(t => {
                if (!t.dueDate) return false;
                const date = new Date(t.dueDate);
                if (!isValid(date)) return false;

                switch (quickFilter) {
                    case 'today':
                        return isWithinInterval(date, { start: todayStart, end: todayEnd });
                    case 'tomorrow':
                         const tomorrow = addDays(now, 1);
                         return isWithinInterval(date, { start: startOfDay(tomorrow), end: endOfDay(tomorrow) });
                    case 'thisWeek':
                        return isWithinInterval(date, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) });
                    case 'thisMonth':
                        return isWithinInterval(date, { start: startOfMonth(now), end: endOfMonth(now) });
                    default:
                        return true;
                }
            });
        } else if (filterDateRange.start && filterDateRange.end) {
             const start = startOfDay(parseISO(filterDateRange.start));
             const end = endOfDay(parseISO(filterDateRange.end));
             if (isValid(start) && isValid(end)) {
                 visible = visible.filter(t => {
                     if (!t.dueDate) return false;
                     const date = new Date(t.dueDate);
                     return isValid(date) && isWithinInterval(date, { start, end });
                 });
             }
        }

        const query = searchQuery.trim();
        if (query) {
          const fuse = new Fuse(visible, { keys: ['title', 'description'], threshold: 0.4 });
          visible = fuse.search(query).map(r => r.item);
        }

        const priorityRank = (p: unknown) => {
          if (p === 'high') return 0;
          if (p === 'medium') return 1;
          if (p === 'low') return 2;
          return 1;
        };

        // Sync local tasks with store tasks when store updates or sort changes
        let nextLocal: Task[];
        if (sortBy === 'custom') {
            nextLocal = orderBy(visible, ['completed', 'position'], ['asc', 'asc']);
        } else if (sortBy === 'priority') {
             const priorityRank = (t: Task) => {
                 if (t.priority === 'high') return 0;
                 if (t.priority === 'medium') return 1;
                 if (t.priority === 'low') return 2;
                 return 1;
             };
             nextLocal = orderBy(visible, ['completed', priorityRank, 'createdAt'], ['asc', 'asc', 'desc']);
        } else if (sortBy === 'dueDate') {
            nextLocal = orderBy(visible, ['completed', 'dueDate'], ['asc', 'asc']);
        } else {
            nextLocal = orderBy(visible, ['completed', 'createdAt'], ['asc', 'desc']);
        }
        setLocalTasks(nextLocal);
        if (sortBy === 'custom' && !reorderPendingRef.current) {
            lastSavedOrderKeyRef.current = nextLocal.map(t => t._id).join('|');
        }
    }, [tasks, sortBy, selectedTaskListId, quickFilter, filterDateRange, statusFilter, searchQuery]);

    const commitReorder = useCallback(async () => {
        if (viewMode !== 'list') return;
        if (sortBy !== 'custom') return;
        if (!reorderPendingRef.current) return;

        reorderPendingRef.current = false;

        const orderedTasks = localTasks.map((task, index) => ({ ...task, position: index }));
        const orderKey = orderedTasks.map(t => t._id).join('|');
        if (orderKey === lastSavedOrderKeyRef.current) return;

        lastSavedOrderKeyRef.current = orderKey;
        await reorderTasks(orderedTasks);
    }, [localTasks, reorderTasks, sortBy, viewMode]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;
        const parentId = selectedTaskListId || undefined;
        await createTask(newTaskTitle, parentId);
        setNewTaskTitle('');
    };

    const handleCreateTaskWithDate = useCallback((date: Date) => {
        setInitialDate(date);
        setSelectedTask(null);
        setIsModalOpen(true);
    }, []);

    const handleCreateFromModal = async (taskData: Omit<Task, '_id' | 'createdAt' | 'updatedAt' | 'userId'>) => {
        const parentId = selectedTaskListId || undefined;
        const reminderOffsets = Array.isArray(taskData.reminderOffsetMinutes)
          ? taskData.reminderOffsetMinutes
          : (typeof taskData.reminderOffsetMinutes === 'number' ? [taskData.reminderOffsetMinutes] : undefined);
        return await createTask(taskData.title, parentId, taskData.dueDate || null, {
            description: taskData.description,
            priority: taskData.priority,
            recurrenceType: taskData.recurrenceType,
            recurrenceDays: taskData.recurrenceDays,
            reminderEnabled: taskData.reminderEnabled,
            reminderOffsetMinutes: reminderOffsets,
            links: (taskData as any).links,
        });
    };

    const toggleComplete = async (task: Task) => {
        await updateTask(task._id, { completed: !task.completed });
    };

    const handleStatusChange = async (task: Task, completed: boolean) => {
        await updateTask(task._id, { completed });
    }

    // Completed tasks in the current scope (selected list, or all lists when none
    // is selected) — drives the "Rensa klara (N)" batch-clear button.
    const completedInScope = useMemo(
        () => tasks.filter(t => t.completed && (!selectedTaskListId ? true : t.parentNoteId === selectedTaskListId)),
        [tasks, selectedTaskListId]
    );

    const handleClearCompleted = async () => {
        if (completedInScope.length === 0) return;
        const scopeText = selectedTaskListId ? ' i den här listan' : '';
        if (!confirm(`Ta bort ${completedInScope.length} klara uppgifter${scopeText}? Detta går inte att ångra.`)) return;
        // Snapshot ids first; deleteTask mutates the store as it goes.
        const ids = completedInScope.map(t => t._id);
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await deleteTask(id);
        }
    };

    const cyclePriority = async (task: Task) => {
        const priorities: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
        const currentIndex = priorities.indexOf(task.priority);
        const nextPriority = priorities[(currentIndex + 1) % priorities.length];
        await updateTask(task._id, { priority: nextPriority });
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high': return 'text-red-600 dark:text-red-400';
            case 'medium': return 'text-yellow-600 dark:text-yellow-400';
            case 'low': return 'text-green-600 dark:text-green-400';
            default: return 'text-gray-500 dark:text-gray-400';
        }
    };

    const moveTask = (dragIndex: number, hoverIndex: number) => {
        if (sortBy !== 'custom') setSortBy('custom');
        const dragTask = localTasks[dragIndex];
        if (!dragTask) return;
        const newTasks = [...localTasks];
        newTasks.splice(dragIndex, 1);
        newTasks.splice(hoverIndex, 0, dragTask);
        reorderPendingRef.current = true;
        setLocalTasks(newTasks);
    };
    
    return (
            <div className="flex flex-col h-full" role="region" aria-label={t('tabs.tasks')}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex justify-between items-center">
                    {!selectedTaskListId ? (
                        <h2 className="font-semibold text-gray-700 dark:text-gray-200">{t('list.allTasks')}</h2>
                    ) : selectedList ? (
                        <input
                            type="text"
                            value={listTitle}
                            onChange={(e) => {
                                const nextTitle = e.target.value;
                                setListTitle(nextTitle);
                                saveListTitle(selectedList._id, nextTitle);
                            }}
                            className="font-semibold text-gray-700 dark:text-gray-200 bg-transparent border-none outline-none min-w-0 flex-1"
                            placeholder={t('common.untitled')}
                            aria-label={t('tasks.listLabel')}
                        />
                    ) : (
                        <h2 className="font-semibold text-gray-700 dark:text-gray-200">{t('tasks.header')}</h2>
                    )}
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-2 items-center">
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded ${viewMode === 'list' ? 'bg-white dark:bg-gray-600 shadow text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                            title={t('tasks.viewList')}
                            aria-label={t('tasks.viewList')}
                        >
                            <FaList />
                        </button>
                        <button 
                            onClick={() => setViewMode('board')}
                            className={`p-2 rounded ${viewMode === 'board' ? 'bg-white dark:bg-gray-600 shadow text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                            title={t('tasks.viewBoard')}
                            aria-label={t('tasks.viewBoard')}
                        >
                            <FaColumns />
                        </button>
                        <button 
                            onClick={() => setViewMode('calendar')}
                            className={`p-2 rounded ${viewMode === 'calendar' ? 'bg-white dark:bg-gray-600 shadow text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                            title={t('tasks.viewCalendar')}
                            aria-label={t('tasks.viewCalendar')}
                        >
                            <FaCalendar />
                        </button>
                        {selectedTaskListId ? (
                            <>
                                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                                <button
                                    onClick={copyListCalendar}
                                    disabled={calBusy}
                                    className="p-2 rounded text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-300 disabled:opacity-50"
                                    title="Kopiera kalenderlänk för denna lista"
                                    aria-label="Kopiera kalenderlänk för denna lista"
                                >
                                    <FaCalendar />
                                </button>
                                {getCalendarUrl(selectedTaskListId) ? (
                                    <button
                                        onClick={revokeListCalendar}
                                        className="p-2 rounded text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                                        title="Inaktivera kalenderlänk"
                                        aria-label="Inaktivera kalenderlänk"
                                    >
                                        <FaTrash />
                                    </button>
                                ) : null}
                            </>
                        ) : null}
                        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`p-2 rounded ${showFilters || quickFilter || (filterDateRange.start && filterDateRange.end) ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                            title={t('tasks.filter.label')}
                        >
                            <FaFilter />
                        </button>
                        {completedInScope.length > 0 && (
                            <button
                                onClick={handleClearCompleted}
                                className="flex items-center gap-1 px-2 py-2 rounded text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                                title={`Rensa ${completedInScope.length} klara uppgifter${selectedTaskListId ? ' i listan' : ''}`}
                                aria-label="Rensa klara uppgifter"
                                data-testid="clear-completed-tasks"
                            >
                                <FaTrash />
                                <span className="text-xs font-medium">Rensa klara ({completedInScope.length})</span>
                            </button>
                        )}
                    </div>
                </div>

                {calMsg && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 break-all px-1 -mt-1">{calMsg}</div>
                )}

                {showFilters && (
                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
                        <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">{t('tasks.filter.status') || 'Status'}:</span>
                            <button
                                onClick={() => setStatusFilter('all')}
                                className={`px-3 py-1 rounded-full text-sm ${statusFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.all') || 'All'}
                            </button>
                            <button
                                onClick={() => setStatusFilter('active')}
                                className={`px-3 py-1 rounded-full text-sm ${statusFilter === 'active' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.active') || 'Active'}
                            </button>
                            <button
                                onClick={() => setStatusFilter('completed')}
                                className={`px-3 py-1 rounded-full text-sm ${statusFilter === 'completed' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.completed') || 'Completed'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => { setQuickFilter('today'); setFilterDateRange({ start: null, end: null }); }}
                                className={`px-3 py-1 rounded-full text-sm ${quickFilter === 'today' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.today')}
                            </button>
                            <button
                                onClick={() => { setQuickFilter('tomorrow'); setFilterDateRange({ start: null, end: null }); }}
                                className={`px-3 py-1 rounded-full text-sm ${quickFilter === 'tomorrow' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.tomorrow')}
                            </button>
                            <button
                                onClick={() => { setQuickFilter('thisWeek'); setFilterDateRange({ start: null, end: null }); }}
                                className={`px-3 py-1 rounded-full text-sm ${quickFilter === 'thisWeek' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.thisWeek')}
                            </button>
                            <button
                                onClick={() => { setQuickFilter('thisMonth'); setFilterDateRange({ start: null, end: null }); }}
                                className={`px-3 py-1 rounded-full text-sm ${quickFilter === 'thisMonth' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'}`}
                            >
                                {t('tasks.filter.thisMonth')}
                            </button>
                            {(quickFilter || filterDateRange.start) && (
                                <button
                                    onClick={() => { setQuickFilter(null); setFilterDateRange({ start: null, end: null }); }}
                                    className="px-3 py-1 rounded-full text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                    {t('tasks.filter.clear')}
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <span>{t('tasks.filter.dateRange')}:</span>
                            <input
                                type="date"
                                value={filterDateRange.start || ''}
                                onChange={(e) => {
                                    setFilterDateRange(prev => ({ ...prev, start: e.target.value }));
                                    setQuickFilter(null);
                                }}
                                className="p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                                aria-label={t('tasks.filter.startDate')}
                            />
                            <span>-</span>
                            <input
                                type="date"
                                value={filterDateRange.end || ''}
                                onChange={(e) => {
                                    setFilterDateRange(prev => ({ ...prev, end: e.target.value }));
                                    setQuickFilter(null);
                                }}
                                className="p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                                aria-label={t('tasks.filter.endDate')}
                            />
                        </div>
                    </div>
                )}

                <form onSubmit={handleCreate} className="flex gap-2">
                    <input
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder={t('tasks.placeholder')}
                        aria-label={t('tasks.placeholder')}
                        className="flex-1 p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-600 dark:placeholder-gray-400"
                    />
                    <button type="submit" aria-label={t('actions.createTask')} className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                        <FaPlus aria-hidden="true" />
                    </button>
                </form>

                 {viewMode === 'list' && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-gray-400">{t('tasks.sort.label')}:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
                            aria-label={t('tasks.sort.label')}
                        >
                            <option value="custom">{t('tasks.sortCustom')}</option>
                            <option value="createdAt">{t('tasks.sortNewest')}</option>
                            <option value="dueDate">{t('tasks.sortDueDate')}</option>
                            <option value="priority">{t('tasks.sortPriority')}</option>
                        </select>
                    </div>
                )}
            </div>
            
            <div className="flex-1 overflow-hidden" role="list" aria-label={t('tabs.tasks')}>
                {isLoading && localTasks.length === 0 && (
                    <div className="flex justify-center p-4">
                         <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
                    </div>
                )}
                {viewMode === 'list' && (
                    <div className="h-full overflow-auto p-2 space-y-2">
                        {localTasks.map((task, index) => (
                            <TaskItem 
                                key={task._id} 
                                index={index} 
                                task={task} 
                                moveTask={moveTask}
                                onDragEnd={commitReorder}
                                toggleComplete={toggleComplete}
                                cyclePriority={cyclePriority}
                                deleteTask={deleteTask}
                                openTaskDetail={openTaskDetail}
                                getPriorityColor={getPriorityColor}
                                t={t}
                                isCustomSort={sortBy === 'custom'}
                            />
                        ))}
                        {localTasks.length === 0 && (
                            <div className="text-center text-gray-600 dark:text-gray-400 text-sm mt-4">
                                {selectedTaskListId ? t('tasks.noTasks') : t('tasks.selectList')}
                            </div>
                        )}
                    </div>
                )}

                {viewMode === 'board' && (
                    <TaskBoard 
                        tasks={localTasks} 
                        onTaskClick={openTaskDetail}
                        onStatusChange={handleStatusChange}
                    />
                )}

                {viewMode === 'calendar' && (
                    <TaskCalendar 
                        tasks={tasks.filter(t => !selectedTaskListId ? true : t.parentNoteId === selectedTaskListId)} 
                        onTaskClick={openTaskDetail} 
                        onCreateTask={handleCreateTaskWithDate}
                    />
                )}
            </div>

            <TaskDetailModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setInitialDate(null); // Reset initialDate on close
                }}
                task={selectedTask}
                initialDate={initialDate}
                onUpdate={updateTask}
                onDelete={deleteTask}
                onCreate={handleCreateFromModal}
            />
        </div>
    );
}
