'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Task } from '@repo/shared';

const TASK_ROW_HEIGHT = 64;
const TASK_OVERSCAN = 12;

export const useTaskListWindowing = ({
  tasks,
  selectedTaskListId,
  searchQuery,
  quickFilter,
  statusFilter,
  sortBy,
  viewMode,
}: {
  tasks: Task[];
  selectedTaskListId: string | null;
  searchQuery: string;
  quickFilter: string | null;
  statusFilter: 'all' | 'active' | 'completed';
  sortBy: 'createdAt' | 'custom' | 'dueDate' | 'title' | 'priority';
  viewMode: 'list' | 'board' | 'calendar';
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    setScrollTop(0);
  }, [quickFilter, searchQuery, selectedTaskListId, sortBy, statusFilter, tasks.length, viewMode]);

  const isVirtualized = viewMode === 'list' && sortBy !== 'custom';

  const visibleRange = useMemo(() => {
    if (!isVirtualized || tasks.length === 0) {
      return {
        startIndex: 0,
        endIndex: tasks.length,
      };
    }

    const estimatedViewportRows = Math.max(1, Math.ceil((viewportHeight || TASK_ROW_HEIGHT * 12) / TASK_ROW_HEIGHT));
    const startIndex = Math.max(0, Math.floor(scrollTop / TASK_ROW_HEIGHT) - TASK_OVERSCAN);
    const endIndex = Math.min(tasks.length, startIndex + estimatedViewportRows + TASK_OVERSCAN * 2);

    return {
      startIndex,
      endIndex,
    };
  }, [isVirtualized, scrollTop, tasks.length, viewportHeight]);

  const visibleListTasks = useMemo(() => {
    if (!isVirtualized) {
      return tasks;
    }
    return tasks.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [isVirtualized, tasks, visibleRange.endIndex, visibleRange.startIndex]);

  const topSpacerHeight = isVirtualized ? visibleRange.startIndex * TASK_ROW_HEIGHT : 0;
  const bottomSpacerHeight = isVirtualized ? Math.max(0, (tasks.length - visibleRange.endIndex) * TASK_ROW_HEIGHT) : 0;

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!isVirtualized) return;
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setViewportHeight(target.clientHeight);
  }, [isVirtualized]);

  return {
    visibleListTasks,
    topSpacerHeight,
    bottomSpacerHeight,
    isVirtualized,
    handleListScroll,
  };
};
