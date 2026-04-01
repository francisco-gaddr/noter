'use client';

import { useMemo } from 'react';
import { Task } from '@repo/shared';
import { orderBy } from 'lodash';
import { startOfDay, endOfDay, isWithinInterval, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, isValid } from 'date-fns';
import Fuse from 'fuse.js';

type SortBy = 'createdAt' | 'custom' | 'dueDate' | 'title' | 'priority';
type StatusFilter = 'all' | 'active' | 'completed';
type DateRange = { start: string | null; end: string | null };

type Options = {
  tasks: Task[];
  selectedTaskListId: string | null;
  sortBy: SortBy;
  quickFilter: string | null;
  filterDateRange: DateRange;
  statusFilter: StatusFilter;
  searchQuery: string;
};

export const useVisibleTasks = ({
  tasks,
  selectedTaskListId,
  sortBy,
  quickFilter,
  filterDateRange,
  statusFilter,
  searchQuery,
}: Options) => {
  const searchIndex = useMemo(() => new Fuse(tasks, { keys: ['title', 'description'], threshold: 0.4 }), [tasks]);

  return useMemo(() => {
  let visible = tasks.filter((task) => (!selectedTaskListId ? true : task.parentNoteId === selectedTaskListId));

  if (statusFilter === 'active') {
    visible = visible.filter((task) => !task.completed);
  } else if (statusFilter === 'completed') {
    visible = visible.filter((task) => task.completed);
  }

  if (quickFilter) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    visible = visible.filter((task) => {
      if (!task.dueDate) return false;
      const date = new Date(task.dueDate);
      if (!isValid(date)) return false;

      switch (quickFilter) {
        case 'today':
          return isWithinInterval(date, { start: todayStart, end: todayEnd });
        case 'tomorrow': {
          const tomorrow = addDays(now, 1);
          return isWithinInterval(date, { start: startOfDay(tomorrow), end: endOfDay(tomorrow) });
        }
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
      visible = visible.filter((task) => {
        if (!task.dueDate) return false;
        const date = new Date(task.dueDate);
        return isValid(date) && isWithinInterval(date, { start, end });
      });
    }
  }

  const query = searchQuery.trim();
  if (query) {
    const resultIds = new Set(searchIndex.search(query).map((result) => result.item._id));
    visible = visible.filter((task) => resultIds.has(task._id));
  }

  if (sortBy === 'custom') {
    return orderBy(visible, ['completed', 'position'], ['asc', 'asc']);
  }

  if (sortBy === 'priority') {
    const priorityRank = (task: Task) => {
      if (task.priority === 'high') return 0;
      if (task.priority === 'medium') return 1;
      if (task.priority === 'low') return 2;
      return 1;
    };
    return orderBy(visible, ['completed', priorityRank, 'createdAt'], ['asc', 'asc', 'desc']);
  }

  if (sortBy === 'dueDate') {
    return orderBy(visible, ['completed', 'dueDate'], ['asc', 'asc']);
  }

  if (sortBy === 'title') {
    return orderBy(visible, ['completed', 'title'], ['asc', 'asc']);
  }

  return orderBy(visible, ['completed', 'createdAt'], ['asc', 'desc']);
  }, [filterDateRange, quickFilter, searchIndex, searchQuery, selectedTaskListId, sortBy, statusFilter, tasks]);
};
