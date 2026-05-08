import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, ScrollView, Alert } from 'react-native';
import { FAB, ActivityIndicator, Menu, IconButton, Divider, useTheme, Chip, Text, TextInput, Button, Portal, Dialog, Avatar } from 'react-native-paper';
import { useRouter, useFocusEffect, useNavigation, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/stores/useStore';
import TaskList from '@/components/TaskList';
import { TaskBoard } from '@/components/TaskBoard';
import { TaskTimeline } from '@/components/TaskTimeline';
import { Task } from '@repo/shared';
import { orderBy } from 'lodash';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SvgUri } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';
import IconPickerModal from '@/components/IconPickerModal';

import { EditListDialog } from '@/components/EditListDialog';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { getReadableProtectedLabel } from '@/utils/protectedNote';

const ListAvatar = ({ uri }: { uri?: string }) => {
  const [failed, setFailed] = useState(false);
  const theme = useTheme();

  if (!uri || failed) {
    return <Avatar.Icon size={18} icon="format-list-bulleted" style={{backgroundColor: 'transparent'}} color={theme.colors.onSurface} />;
  }

  if (uri.startsWith('Fa')) {
    const toFa5 = (faKey: string) => {
        const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
        return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    };
    return <FontAwesome5 name={toFa5(uri) as any} size={18} color={theme.colors.onSurface} />;
  }

  return <SvgUri uri={uri} width={18} height={18} onError={() => setFailed(true)} />;
};

const STORAGE_KEY_LIST = 'last_selected_list_id';
const STORAGE_KEY_VIEW = 'last_view_mode';
const STORAGE_KEY_FILTERS = 'task_filters';
const STORAGE_KEY_SORT = 'task_sort';

const getQuickFilterRange = (type: string) => {
  const start = new Date();
  const end = new Date();
  if (type === 'today') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (type === 'tomorrow') {
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (type === 'week') {
    const day = start.getDay() || 7;
    if (day !== 1) start.setHours(-24 * (day - 1));
    else start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (type === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  return { start: null, end: null } as { start: Date | null; end: Date | null };
};

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list') return 'task_list';
  return normalized || 'note';
};

const parseTaskDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

export default function TasksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const tasks = useStore((state) => state.tasks);
  const notes = useStore((state) => state.notes);
  const isRefreshingNotes = useStore((state) => state.isRefreshingNotes);
  const isRefreshingTasks = useStore((state) => state.isRefreshingTasks);
  const fetchTasks = useStore((state) => state.fetchTasks);
  const fetchNotes = useStore((state) => state.fetchNotes);
  const updateTask = useStore((state) => state.updateTask);
  const reorderTasks = useStore((state) => state.reorderTasks);
  const createNote = useStore((state) => state.createNote);
  const updateNote = useStore((state) => state.updateNote);
  const deleteNote = useStore((state) => state.deleteNote);
  const deleteTask = useStore((state) => state.deleteTask);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'calendar'>('list');

  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'dueDate' | 'priority' | 'custom'>('custom');

  // Edit List Dialog
  const [editListDialogVisible, setEditListDialogVisible] = useState(false);
  const [editingList, setEditingList] = useState<{id: string, title: string} | null>(null);

  // Filter State
  const [filterDialogVisible, setFilterDialogVisible] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState<{start: Date | null, end: Date | null}>({start: null, end: null});
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [showDatePicker, setShowDatePicker] = useState<'start' | 'end' | null>(null);
  const selectedChipBg = useMemo(() => theme.colors.primary, [theme]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskCountRef = useRef(tasks.length);

  useEffect(() => {
    taskCountRef.current = tasks.length;
  }, [tasks.length]);

  // Load persistence
  useEffect(() => {
    const loadState = async () => {
      try {
        const savedListId = await AsyncStorage.getItem(STORAGE_KEY_LIST);
        const savedViewMode = await AsyncStorage.getItem(STORAGE_KEY_VIEW);
        const savedFilters = await AsyncStorage.getItem(STORAGE_KEY_FILTERS);
        
        if (savedListId) setSelectedListId(savedListId === 'all' ? null : savedListId);
        if (savedViewMode) setViewMode(savedViewMode as any);
        if (savedFilters) {
            const parsed = JSON.parse(savedFilters);
            setQuickFilter(parsed.quickFilter);
            setStatusFilter(parsed.statusFilter || 'all');
            if (parsed.quickFilter && ['today', 'tomorrow', 'week', 'month'].includes(parsed.quickFilter)) {
              setFilterDateRange(getQuickFilterRange(parsed.quickFilter));
            } else {
              setFilterDateRange({
                start: parsed.start ? new Date(parsed.start) : null,
                end: parsed.end ? new Date(parsed.end) : null
              });
            }
        }
        const savedSort = await AsyncStorage.getItem(STORAGE_KEY_SORT);
        if (savedSort) {
          const parsedSort = JSON.parse(savedSort);
          if (parsedSort?.sortBy) setSortBy(parsedSort.sortBy);
          if (parsedSort?.sortOrder) setSortOrder(parsedSort.sortOrder);
        }
      } catch (e) {
        console.log('Failed to load state', e);
      } finally {
        setSettingsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Save persistence
  useEffect(() => {
    if (!settingsLoaded) return;
    if (settingsPersistTimeoutRef.current) {
      clearTimeout(settingsPersistTimeoutRef.current);
    }
    settingsPersistTimeoutRef.current = setTimeout(() => {
      void AsyncStorage.multiSet([
        [STORAGE_KEY_LIST, selectedListId || 'all'],
        [STORAGE_KEY_VIEW, viewMode],
        [STORAGE_KEY_FILTERS, JSON.stringify({
          quickFilter,
          statusFilter,
          start: filterDateRange.start ? filterDateRange.start.toISOString() : null,
          end: filterDateRange.end ? filterDateRange.end.toISOString() : null
        })],
        [STORAGE_KEY_SORT, JSON.stringify({ sortBy, sortOrder })],
      ]);
    }, 180);
    return () => {
      if (settingsPersistTimeoutRef.current) {
        clearTimeout(settingsPersistTimeoutRef.current);
        settingsPersistTimeoutRef.current = null;
      }
    };
  }, [selectedListId, viewMode, filterDateRange, quickFilter, statusFilter, sortBy, sortOrder, settingsLoaded]);

  const applyQuickFilter = (type: string) => {
      const { start, end } = getQuickFilterRange(type);
      setQuickFilter(type);
      setFilterDateRange({ start, end });
  };

  const clearFilters = () => {
      setQuickFilter(null);
      setStatusFilter('all');
      setFilterDateRange({ start: null, end: null });
      setFilterDialogVisible(false);
  };



  const lastFocusRefreshAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const activeListId = selectedListId && selectedListId !== 'all' ? selectedListId : undefined;
      const shouldRefresh = now - lastFocusRefreshAtRef.current > 1500 || taskCountRef.current === 0;

      if (!shouldRefresh) {
        return;
      }

      lastFocusRefreshAtRef.current = now;
      void fetchNotes();
      void fetchTasks(activeListId);
    }, [fetchNotes, fetchTasks, selectedListId])
  );

  const filteredTasks = useMemo(() => {
    let result = tasks.filter(t => !selectedListId ? true : t.parentNoteId === selectedListId);
    
    // Status Filter
    if (statusFilter === 'active') {
        result = result.filter(t => !t.completed);
    } else if (statusFilter === 'completed') {
        result = result.filter(t => t.completed);
    }

    // Date Filter
    if (filterDateRange.start && filterDateRange.end) {
        result = result.filter(t => {
            const d = parseTaskDate(t.dueDate);
            if (!d) return false;
            return d >= filterDateRange.start! && d <= filterDateRange.end!;
        });
    }

    return result;
  }, [tasks, selectedListId, statusFilter, filterDateRange]);

  const sortedTasks = useMemo(() => {
    if (sortBy === 'custom') {
        return orderBy(filteredTasks, ['completed', 'position'], ['asc', 'asc']);
    }
    if (sortBy === 'priority') {
        const priorityRank = (p: unknown) => {
            if (p === 'high') return 0;
            if (p === 'medium') return 1;
            if (p === 'low') return 2;
            return 1;
        };
        return orderBy(filteredTasks, ['completed', (t) => priorityRank((t as any).priority), 'createdAt'], ['asc', 'asc', 'desc']);
    }
    return orderBy(filteredTasks, ['completed', sortBy], ['asc', sortOrder]);
  }, [filteredTasks, sortBy, sortOrder]);

  const sortedLists = useMemo(() => {
    const lists = notes.filter((n) => normalizeNoteType((n as any).type) === 'task_list');
    return orderBy(lists, [(n) => (typeof (n as any).order === 'number' ? (n as any).order : 0), 'createdAt'], ['asc', 'desc']);
  }, [notes]);

  const getListLabel = useCallback((list: any) => (
    getReadableProtectedLabel(
      (list as any).__rawEncryptedTitle ?? list?.title,
      list?.title,
      t('tasks.listFallback'),
    )
  ), [t]);

  const handleIconSelect = async (icon: string) => {
    if (!selectedListId) return;
    try {
      await updateNote(selectedListId, { icon });
    } finally {
      setIconPickerVisible(false);
    }
  };

  const handleCreateTask = () => {
    const parentId = selectedListId && selectedListId !== 'all' ? selectedListId : undefined;
    router.push({
      pathname: '/task/new',
      params: parentId ? { parentNoteId: parentId } : {},
    } as any);
  };

  const handleCreateTaskWithDate = (date: Date) => {
    const parentId = selectedListId && selectedListId !== 'all' ? selectedListId : undefined;
    router.push({
      pathname: '/task/new',
      params: { 
        ...(parentId ? { parentNoteId: parentId } : {}),
        dueDate: date.toISOString()
      },
    } as any);
  };

  const handleCreateList = async () => {
    try {
      const created = await createNote({
        title: 'Ny lista',
        content: '',
        type: 'task_list'
      });
      setSelectedListId(created._id);
    } catch {}
  };

  const handleToggleComplete = useCallback(async (task: Task) => {
    try {
      await updateTask(task._id, { completed: !task.completed });
    } catch (error) {
      console.error('Failed to update task', error);
    }
  }, [updateTask]);

  const handleReorder = useCallback((newTasks: Task[]) => {
    if (sortBy === 'custom') {
        reorderTasks(newTasks);
    }
  }, [reorderTasks, sortBy]);

  const handleDeleteTask = useCallback((task: Task) => {
    Alert.alert(
      t('tasks.deleteTitle'),
      t('tasks.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => deleteTask(task._id) }
      ]
    );
  }, [deleteTask, t]);

  const handleLongPressList = (list: any) => {
    setEditingList({ id: list._id, title: getListLabel(list) });
    setEditListDialogVisible(true);
  };

  const saveListTitle = async () => {
    if (editingList) {
        await updateNote(editingList.id, { title: editingList.title });
        setEditListDialogVisible(false);
        setEditingList(null);
        fetchNotes(); // Refresh lists
    }
  };
  
  const deleteCurrentList = async () => {
    if (editingList) {
      try {
        await deleteNote(editingList.id);
        setEditListDialogVisible(false);
        setEditingList(null);
        // If deleted list was selected, fallback to "Alla"
        if (selectedListId === editingList.id) {
          setSelectedListId(null);
        }
        await fetchNotes();
        await fetchTasks();
      } catch (e) {
        // Non-fatal
      }
    }
  };
  
  const confirmDeleteCurrentList = () => {
    if (!editingList) return;
    Alert.alert(
      'Ta bort lista',
      'Är du säker på att du vill ta bort listan? Alla tasks i listan tas också bort.',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Ta bort', style: 'destructive', onPress: deleteCurrentList },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{
        headerTitle: 'Tasks',
        headerRight: () => (
          <View style={{ flexDirection: 'row' }}>
             <IconButton
              icon={filterDateRange.start || statusFilter !== 'all' ? "filter" : "filter-outline"}
              onPress={() => setFilterDialogVisible(true)}
              size={20}
            />
             <IconButton
              icon="format-list-bulleted"
              selected={viewMode === 'list'}
              onPress={() => setViewMode('list')}
              size={20}
            />
            <IconButton
              icon="view-dashboard"
              selected={viewMode === 'board'}
              onPress={() => setViewMode('board')}
              size={20}
            />
            <IconButton
              icon="calendar"
              selected={viewMode === 'calendar'}
              onPress={() => setViewMode('calendar')}
              size={20}
            />
            <Menu
              visible={sortMenuVisible}
              onDismiss={() => setSortMenuVisible(false)}
              anchor={
                <IconButton
                  icon="sort"
                  onPress={() => {
                      setSortMenuVisible(false);
                      setTimeout(() => setSortMenuVisible(true), 0);
                  }}
                />
              }
            >
              <Menu.Item 
                onPress={() => { setSortBy('custom'); setSortMenuVisible(false); }} 
                title={t('tasks.sort.custom')}
                leadingIcon={sortBy === 'custom' ? 'check' : undefined}
              />
              <Divider />
              <Menu.Item 
                onPress={() => { setSortBy('createdAt'); setSortOrder('desc'); setSortMenuVisible(false); }} 
                title={t('sort.newest')} 
                leadingIcon={sortBy === 'createdAt' && sortOrder === 'desc' ? 'check' : undefined}
              />
              <Menu.Item 
                onPress={() => { setSortBy('createdAt'); setSortOrder('asc'); setSortMenuVisible(false); }} 
                title={t('sort.oldest')}
                leadingIcon={sortBy === 'createdAt' && sortOrder === 'asc' ? 'check' : undefined}
              />
              <Divider />
              <Menu.Item 
                onPress={() => { setSortBy('dueDate'); setSortOrder('asc'); setSortMenuVisible(false); }} 
                title={t('tasks.sort.dueDateAsc')}
                leadingIcon={sortBy === 'dueDate' && sortOrder === 'asc' ? 'check' : undefined}
              />
              <Menu.Item 
                onPress={() => { setSortBy('dueDate'); setSortOrder('desc'); setSortMenuVisible(false); }} 
                title={t('tasks.sort.dueDateDesc')}
                leadingIcon={sortBy === 'dueDate' && sortOrder === 'desc' ? 'check' : undefined}
              />
              <Divider />
              <Menu.Item 
                onPress={() => { setSortBy('priority'); setSortOrder('asc'); setSortMenuVisible(false); }} 
                title={t('tasks.sort.priority')}
                leadingIcon={sortBy === 'priority' ? 'check' : undefined}
              />
              <Divider />
              <Menu.Item 
                onPress={() => { setSortBy('title'); setSortOrder('asc'); setSortMenuVisible(false); }} 
                title={t('sort.titleAsc')}
                leadingIcon={sortBy === 'title' && sortOrder === 'asc' ? 'check' : undefined}
              />
            </Menu>
          </View>
        ),
      }} />
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
          <Chip
             selected={selectedListId === null}
             onPress={() => setSelectedListId(null)}
             style={[styles.tabChip, selectedListId === null ? { backgroundColor: selectedChipBg } : null]}
             icon="format-list-bulleted"
             showSelectedCheck={false}
             textStyle={{ color: selectedListId === null ? theme.colors.onPrimary : theme.colors.onSurface, fontWeight: selectedListId === null ? '700' : '400' }}
          >
            Alla
          </Chip>
          {sortedLists.map(list => (
            <Chip
              key={list._id}
              selected={selectedListId === list._id}
              onPress={() => setSelectedListId(list._id)}
              onLongPress={() => handleLongPressList(list)}
              style={[styles.tabChip, selectedListId === list._id ? { backgroundColor: selectedChipBg } : null]}
              avatar={<ListAvatar uri={(list as any).icon || undefined} />}
              showSelectedCheck={false}
              textStyle={{ color: selectedListId === list._id ? theme.colors.onPrimary : theme.colors.onSurface, fontWeight: selectedListId === list._id ? '700' : '400' }}
            >
              {getListLabel(list)}
            </Chip>
          ))}
          <IconButton icon="plus" size={18} onPress={handleCreateList} />
        </ScrollView>
      </View>

      {viewMode === 'list' ? (
        <TaskList
          tasks={sortedTasks}
          onRefresh={() => {
            void Promise.all([fetchTasks(), fetchNotes()]);
          }}
          refreshing={isRefreshingTasks || isRefreshingNotes}
          onToggleComplete={handleToggleComplete}
          onReorder={sortBy === 'custom' ? handleReorder : undefined}
          showViewToggle={false}
          onCreateTask={handleCreateTaskWithDate}
          onDelete={handleDeleteTask}
          preSorted={true}
        />
      ) : viewMode === 'board' ? (
        <TaskBoard
          tasks={sortedTasks}
          onTaskPress={(task: Task) => router.push(`/task/${task._id}`)}
          onToggleComplete={handleToggleComplete}
        />
      ) : (
        <TaskTimeline
          tasks={sortedTasks}
          onTaskPress={(task: Task) => router.push(`/task/${task._id}`)}
          onCreateTask={handleCreateTaskWithDate}
        />
      )}
      
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleCreateTask}
        label={t('tasks.new')}
      />

      <Portal>
      <EditListDialog
        visible={editListDialogVisible}
        initialTitle={editingList?.title || ''}
        onDismiss={() => setEditListDialogVisible(false)}
        onSave={async (newTitle) => {
            if (editingList) {
                await updateNote(editingList.id, { title: newTitle });
                setEditListDialogVisible(false);
                setEditingList(null);
                fetchNotes(); // Refresh lists
            }
        }}
        onDelete={confirmDeleteCurrentList}
        onChangeIcon={() => {
            setEditListDialogVisible(false);
            if (editingList) {
                setSelectedListId(editingList.id);
                setIconPickerVisible(true);
            }
        }}
      />

        <Dialog visible={filterDialogVisible} onDismiss={() => setFilterDialogVisible(false)}>
            <Dialog.Title>{t('tasks.filter.title')}</Dialog.Title>
            <Dialog.Content>
                <Text variant="bodyMedium" style={{marginBottom: 8}}>{t('tasks.filter.status')}</Text>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
                    <Chip selected={statusFilter === 'all'} onPress={() => setStatusFilter('all')}>{t('common.all')}</Chip>
                    <Chip selected={statusFilter === 'active'} onPress={() => setStatusFilter('active')}>{t('tasks.status.active')}</Chip>
                    <Chip selected={statusFilter === 'completed'} onPress={() => setStatusFilter('completed')}>{t('tasks.status.completed')}</Chip>
                </View>

                <Divider style={{marginBottom: 16}} />

                <Text variant="bodyMedium" style={{marginBottom: 8}}>{t('tasks.filter.quickDates')}</Text>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
                    <Chip selected={quickFilter === 'today'} onPress={() => applyQuickFilter('today')}>{t('tasks.filter.today')}</Chip>
                    <Chip selected={quickFilter === 'tomorrow'} onPress={() => applyQuickFilter('tomorrow')}>{t('tasks.filter.tomorrow')}</Chip>
                    <Chip selected={quickFilter === 'week'} onPress={() => applyQuickFilter('week')}>{t('tasks.filter.week')}</Chip>
                    <Chip selected={quickFilter === 'month'} onPress={() => applyQuickFilter('month')}>{t('tasks.filter.month')}</Chip>
                </View>
                <Divider style={{marginBottom: 16}} />
                <Text variant="bodyMedium" style={{marginBottom: 8}}>{t('tasks.filter.dateRange')}</Text>
                <View style={{flexDirection: 'row', gap: 8}}>
                    <Button mode="outlined" onPress={() => setShowDatePicker('start')} style={{flex: 1}}>
                        {filterDateRange.start ? filterDateRange.start.toLocaleDateString() : t('tasks.filter.startDate')}
                    </Button>
                    <Button mode="outlined" onPress={() => setShowDatePicker('end')} style={{flex: 1}}>
                        {filterDateRange.end ? filterDateRange.end.toLocaleDateString() : t('tasks.filter.endDate')}
                    </Button>
                </View>
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={clearFilters}>{t('tasks.filter.clear')}</Button>
                <Button onPress={() => setFilterDialogVisible(false)}>{t('common.ok')}</Button>
            </Dialog.Actions>
        </Dialog>
        
        {showDatePicker && (
            <DateTimePicker
                value={showDatePicker === 'start' ? (filterDateRange.start || new Date()) : (filterDateRange.end || new Date())}
                mode="date"
                display="default"
                onChange={(event, selectedDate) => {
                    setShowDatePicker(null);
                    if (selectedDate && event.type !== 'dismissed') {
                        setQuickFilter(null);
                        if (showDatePicker === 'start') {
                            const date = selectedDate;
                            date.setHours(0,0,0,0);
                            setFilterDateRange(prev => ({ ...prev, start: date }));
                        } else {
                            const date = selectedDate;
                            date.setHours(23,59,59,999);
                            setFilterDateRange(prev => ({ ...prev, end: date }));
                        }
                    }
                }}
            />
        )}

        {selectedListId && selectedListId !== 'all' && (
          <IconPickerModal
            visible={iconPickerVisible}
            onDismiss={() => setIconPickerVisible(false)}
            onSelect={handleIconSelect}
            currentIcon={(notes.find(n => n._id === selectedListId) as any)?.icon}
          />
        )}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabsContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee' // Light border for separation
  },
  tabsContent: {
    alignItems: 'center',
    paddingRight: 16
  },
  tabChip: {
    marginHorizontal: 4
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});

function withAlpha(color: string, alpha: number) {
  if (typeof color !== 'string') return color as any;
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) return color;
  if (!color.startsWith('#')) return color;

  const hex = color.slice(1);
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}
