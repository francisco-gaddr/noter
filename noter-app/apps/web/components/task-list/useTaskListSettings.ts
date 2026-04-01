'use client';

import { useCallback, useEffect, useState } from 'react';

type DateRange = { start: string | null; end: string | null };
type SortBy = 'createdAt' | 'custom' | 'dueDate' | 'title' | 'priority';
type ViewMode = 'list' | 'board' | 'calendar';
type StatusFilter = 'all' | 'active' | 'completed';
const TASK_SETTING_KEYS = ['taskSortBy', 'taskViewMode', 'taskFilterDateRange', 'taskQuickFilter', 'taskStatusFilter'] as const;

export const useTaskListSettings = () => {
  const [sortBy, setSortBy] = useState<SortBy>('custom');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterDateRange, setFilterDateRange] = useState<DateRange>({ start: null, end: null });
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const getPersistedSetting = useCallback(async (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    const mlc = (window as any).mlc;
    if (mlc?.isElectron && typeof mlc.getSetting === 'function') {
      try {
        const value = await mlc.getSetting(key);
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
          return value;
        }
      } catch {}
    }
    const fromLocal = localStorage.getItem(key);
    if (fromLocal !== null) return fromLocal;
    return null;
  }, []);

  const setPersistedSetting = useCallback((key: string, value: string | null) => {
    if (typeof window === 'undefined') return;
    const mlc = (window as any).mlc;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    if (mlc?.isElectron && typeof mlc.setSetting === 'function') {
      mlc.setSetting(key, value);
    }
  }, []);

  const getPersistedSettings = useCallback(async () => {
    if (typeof window === 'undefined') return {} as Record<string, string | null>;
    const mlc = (window as any).mlc;
    if (mlc?.isElectron && typeof mlc.getManySettings === 'function') {
      try {
        const values = await mlc.getManySettings([...TASK_SETTING_KEYS]);
        Object.entries(values || {}).forEach(([key, value]) => {
          if (typeof value === 'string') {
            localStorage.setItem(key, value);
          }
        });
        return values as Record<string, string | null>;
      } catch {}
    }

    const entries = await Promise.all(TASK_SETTING_KEYS.map(async (key) => [key, await getPersistedSetting(key)] as const));
    return Object.fromEntries(entries) as Record<string, string | null>;
  }, [getPersistedSetting]);

  const setPersistedSettings = useCallback((values: Record<string, string | null>) => {
    if (typeof window === 'undefined') return;
    const mlc = (window as any).mlc;
    Object.entries(values).forEach(([key, value]) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    if (mlc?.isElectron && typeof mlc.setManySettings === 'function') {
      mlc.setManySettings(values);
      return;
    }
    Object.entries(values).forEach(([key, value]) => {
      if (mlc?.isElectron && typeof mlc.setSetting === 'function') {
        mlc.setSetting(key, value);
      }
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await getPersistedSettings();
      const savedSort = settings.taskSortBy;
      const savedView = settings.taskViewMode;
      const savedFilterRange = settings.taskFilterDateRange;
      const savedQuickFilter = settings.taskQuickFilter;
      const savedStatusFilter = settings.taskStatusFilter;

      if (!alive) return;
      if (savedSort) setSortBy(savedSort as SortBy);
      if (savedView) setViewMode(savedView as ViewMode);
      if (savedFilterRange) {
        try {
          setFilterDateRange(JSON.parse(savedFilterRange));
        } catch {}
      }
      if (savedQuickFilter) setQuickFilter(savedQuickFilter);
      if (savedStatusFilter) setStatusFilter(savedStatusFilter as StatusFilter);
      setSettingsLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [getPersistedSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    setPersistedSettings({
      taskSortBy: sortBy,
      taskViewMode: viewMode,
      taskFilterDateRange: JSON.stringify(filterDateRange),
      taskStatusFilter: statusFilter,
      taskQuickFilter: quickFilter || null,
    });
  }, [filterDateRange, quickFilter, settingsLoaded, setPersistedSettings, sortBy, statusFilter, viewMode]);

  return {
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    filterDateRange,
    setFilterDateRange,
    quickFilter,
    setQuickFilter,
    statusFilter,
    setStatusFilter,
    settingsLoaded,
  };
};
