import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Alert, TouchableOpacity, SectionList } from 'react-native';
import { IconButton, useTheme, Chip, Button } from 'react-native-paper';
import { Task } from '@repo/shared';
import { PanGestureHandler, PanGestureHandlerGestureEvent, ScrollView } from 'react-native-gesture-handler';
import { useStore } from '@/stores/useStore';
import { Calendar } from 'react-native-calendars';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDate } from '@/utils/dateFormat';

// --- Utils ---

const SLOT_HEIGHT = 48; // px per hour
const STORAGE_KEY_CALENDAR_MODE = 'task_calendar_mode';
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekStart(d: Date) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday=0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, days: number) {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}

function parseDueDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) {
      const parsed = new Date(Number(value));
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    const assumedDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) || /T00:00:00(?:\.000)?Z$/.test(value);
    if (assumedDateOnly) {
      const datePart = value.split('T')[0];
      const [y, m, d] = datePart.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      if (!/[T ]\d{2}:\d{2}/.test(value)) {
        parsed.setHours(0, 0, 0, 0);
      }
      return parsed;
    }
  }
  return null;
}

function hasExplicitTime(value: unknown) {
  if (typeof value !== 'string') return false;
  return /[T ]\d{2}:\d{2}/.test(value) && !/T00:00:00(?:\.000)?Z$/.test(value);
}

function getTaskHour(task: Task) {
  const parsed = parseDueDate(task.dueDate);
  if (!parsed) return null;
  if (!hasExplicitTime(task.dueDate)) return 0;
  return parsed.getHours();
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(d: Date) {
  const today = new Date();
  return d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
}

function getCurrentTimePosition() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return (hours + minutes / 60) * SLOT_HEIGHT;
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);
  // formatDate respects the device locale + falls back to ISO if Intl breaks.
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatAgendaHeader(key: string) {
  const d = new Date(key);
  const today = new Date();
  const isToday = d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
    
  if (isToday) return 'Idag';
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear();
    
  if (isTomorrow) return 'Imorgon';
  
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

interface TaskTimelineProps {
  tasks: Task[];
  onTaskPress: (task: Task) => void;
  onCreateTask?: (date: Date) => void;
}

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export const TaskTimeline: React.FC<TaskTimelineProps> = ({ tasks, onTaskPress, onCreateTask }) => {
  const theme = useTheme();
  const { updateTask } = useStore();
  const [mode, setMode] = useState<ViewMode>('week');
  const [selectedDate, setSelectedDate] = useState(new Date()); // For Day/Week anchor
  const todayKey = dateKey(new Date());
  const timeScrollRef = useRef<ScrollView>(null);
  const agendaRef = useRef<SectionList<any>>(null);

  useEffect(() => {
    const loadMode = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY_CALENDAR_MODE);
        if (stored === 'day' || stored === 'week' || stored === 'month' || stored === 'agenda') {
          setMode(stored);
        }
      } catch {
      }
    };
    loadMode();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY_CALENDAR_MODE, mode);
  }, [mode]);
  
  // State for dragging in TimeGrid
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ taskId: string; dayIndex: number; hourIndex: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ dayIndex: number; hourIndex: number } | null>(null);
  
  // Update current time line every minute
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('task_timeline_mode')
      .then((stored) => {
        if (stored === 'day' || stored === 'week' || stored === 'month' || stored === 'agenda') {
          setMode(stored);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem('task_timeline_mode', mode).catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== 'day' && mode !== 'week') return;
    requestAnimationFrame(() => {
      const y = Math.max(getCurrentTimePosition() - SLOT_HEIGHT * 1.5, 0);
      timeScrollRef.current?.scrollTo({ y, animated: false });
    });
  }, [mode, selectedDate]);

  // Memoized styles/theme for Calendar
  const calendarTheme = useMemo(() => ({
    backgroundColor: theme.colors.background,
    calendarBackground: theme.colors.surface,
    textSectionTitleColor: theme.colors.onSurface,
    selectedDayBackgroundColor: theme.colors.primary,
    selectedDayTextColor: theme.colors.onPrimary,
    todayTextColor: theme.colors.primary,
    dayTextColor: theme.colors.onSurface,
    textDisabledColor: theme.colors.onSurfaceDisabled,
    dotColor: theme.colors.primary,
    selectedDotColor: theme.colors.onPrimary,
    monthTextColor: theme.colors.onSurface,
    indicatorColor: theme.colors.primary,
    agendaDayTextColor: theme.colors.onSurfaceVariant,
    agendaDayNumColor: theme.colors.onSurfaceVariant,
    agendaTodayColor: theme.colors.primary,
    agendaKnobColor: theme.colors.onSurfaceVariant,
  }), [theme]);

  // --- Helpers for TimeGrid (Day/Week) ---

  const getDaysForMode = useCallback(() => {
    if (mode === 'day') {
      return [selectedDate];
    }
    // Week mode
    return Array.from({ length: 7 }, (_, idx) => addDays(getWeekStart(selectedDate), idx));
  }, [mode, selectedDate]);

  const days = useMemo(() => getDaysForMode(), [getDaysForMode]);
  
  const columnWidth = useMemo(() => {
    const width = Dimensions.get('window').width;
    if (mode === 'day') return width - 64;
    return Math.floor((width - 64) / 7);
  }, [mode]);

  const positioned = useMemo(() => {
    try {
      const map: Record<string, Task[]> = {};
      for (const day of days) {
        const key = dateKey(day);
        map[key] = [];
      }
      for (const t of tasks) {
        const parsed = parseDueDate(t.dueDate);
        if (!parsed) continue;
        const normalized = new Date(parsed);
        normalized.setHours(0, 0, 0, 0);
        const key = dateKey(normalized);
        if (map[key]) map[key].push(t);
      }
      return map;
    } catch (e) {
      console.log('[Timeline] positioning error', e);
      return {};
    }
  }, [tasks, days]);

  const onPan = (task: Task) => (e: PanGestureHandlerGestureEvent) => {
    const { translationX, translationY, state } = (e as any).nativeEvent || {};
    if (!draggingId && state === 2 /* ACTIVE */) {
      setDraggingId(task._id);
      const due = parseDueDate(task.dueDate) || new Date();
      const hourIndex = clamp(due.getHours(), 0, 23);
      let dayIndex = 0;
      if (mode === 'week') {
        const start = getWeekStart(selectedDate);
        const dueDay = new Date(due);
        dueDay.setHours(0, 0, 0, 0);
        dayIndex = clamp(Math.round((dueDay.getTime() - start.getTime()) / 86400000), 0, 6);
      }
      dragStartRef.current = { taskId: task._id, dayIndex, hourIndex };
      setDragPreview({ dayIndex, hourIndex });
      return;
    }

    if (dragStartRef.current?.taskId !== task._id) return;
    if (state !== 2 /* ACTIVE */) return;
    const base = dragStartRef.current;
    const deltaDays = mode === 'week' ? Math.round(translationX / columnWidth) : 0;
    const deltaHours = Math.round(translationY / SLOT_HEIGHT);
    const nextDayIndex = clamp(base.dayIndex + deltaDays, 0, mode === 'week' ? 6 : 0);
    const nextHourIndex = clamp(base.hourIndex + deltaHours, 0, 23);
    setDragPreview({ dayIndex: nextDayIndex, hourIndex: nextHourIndex });
  };

  const onPanEnd = (task: Task) => async (e: any) => {
    const { translationX, translationY } = (e as any).nativeEvent || {};
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setDragPreview(null);
    setDraggingId(null);
    try {
      if (!start) return;
      const deltaDays = mode === 'week' ? Math.round(translationX / columnWidth) : 0;
      const deltaHours = Math.round(translationY / SLOT_HEIGHT);
      const dayIndex = clamp(start.dayIndex + deltaDays, 0, mode === 'week' ? 6 : 0);
      const hourIndex = clamp(start.hourIndex + deltaHours, 0, 23);
      
      const targetDate = mode === 'week' ? addDays(getWeekStart(selectedDate), dayIndex) : selectedDate;
      const updated = new Date(targetDate);
      updated.setHours(hourIndex, 0, 0, 0);
      
      await updateTask(task._id, { dueDate: updated.toISOString() });
    } catch (err: any) {
      Alert.alert('Fel', err?.message || 'Kunde inte uppdatera tid');
    }
  };

  // --- Helpers for Agenda/Month ---
  
  const markedDates = useMemo(() => {
    const marked: any = {};
    tasks.forEach(t => {
      const parsed = parseDueDate(t.dueDate);
      if (parsed) {
        const dateStr = dateKey(parsed);
        marked[dateStr] = { ...(marked[dateStr] || {}), marked: true, dotColor: theme.colors.primary };
      }
    });

    const selectedStr = dateKey(selectedDate);
    marked[todayKey] = {
      ...(marked[todayKey] || {}),
      customStyles: {
        container: {
          backgroundColor: theme.colors.primary,
          borderRadius: 16,
        },
        text: {
          color: theme.colors.onPrimary,
          fontWeight: '700',
        },
      },
    };

    marked[selectedStr] = {
      ...(marked[selectedStr] || {}),
      customStyles: {
        container: {
          backgroundColor: theme.colors.primary,
          borderRadius: 16,
        },
        text: {
          color: theme.colors.onPrimary,
          fontWeight: '700',
        },
      },
    };
    return marked;
  }, [tasks, selectedDate, theme, todayKey]);

  const agendaSections = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    const end = new Date(today);
    end.setDate(end.getDate() + 90);

    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const parsed = parseDueDate(task.dueDate);
      if (!parsed) continue;
      const d = new Date(parsed);
      d.setHours(0, 0, 0, 0);
      if (d < start || d > end) continue;
      const key = dateKey(d);
      const current = groups.get(key) || [];
      current.push(task);
      groups.set(key, current);
    }

    if (today >= start && today <= end) {
      const key = dateKey(today);
      if (!groups.has(key)) groups.set(key, []);
    }

    const keys = Array.from(groups.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return keys.map((key) => {
      const data = (groups.get(key) || []).slice().sort((a, b) => {
        const ta = parseDueDate(a.dueDate)?.getTime() ?? 0;
        const tb = parseDueDate(b.dueDate)?.getTime() ?? 0;
        return ta - tb;
      });
      return { title: key, data };
    });
  }, [tasks]);

  useEffect(() => {
    if (mode !== 'agenda') return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const idx = agendaSections.findIndex((section) => section.title === dateKey(today));
    const targetIndex = idx >= 0 ? idx : 0;
    const runScroll = () => {
      agendaRef.current?.scrollToLocation({
        sectionIndex: targetIndex,
        itemIndex: 0,
        viewPosition: 0,
        viewOffset: 12,
        animated: false,
      });
    };
    requestAnimationFrame(() => {
      runScroll();
      setTimeout(runScroll, 0);
    });
  }, [mode, agendaSections]);

  // --- Renderers ---

  const renderHeader = () => (
    <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="chevron-left" onPress={() => {
                if (mode === 'week') setSelectedDate(addDays(selectedDate, -7));
                else if (mode === 'day') setSelectedDate(addDays(selectedDate, -1));
                else if (mode === 'month') {
                    const d = new Date(selectedDate);
                    d.setMonth(d.getMonth() - 1);
                    setSelectedDate(d);
                }
            }} />
            <Text style={{ color: theme.colors.onBackground, fontWeight: '600', minWidth: 100, textAlign: 'center' }}>
            {mode === 'week' ? formatWeekRange(getWeekStart(selectedDate)) : selectedDate.toLocaleDateString()}
            </Text>
            <IconButton
              icon="calendar-today"
              accessibilityLabel="Gå till idag"
              onPress={() => setSelectedDate(new Date())}
            />
            <IconButton icon="chevron-right" onPress={() => {
                if (mode === 'week') setSelectedDate(addDays(selectedDate, 7));
                else if (mode === 'day') setSelectedDate(addDays(selectedDate, 1));
                else if (mode === 'month') {
                    const d = new Date(selectedDate);
                    d.setMonth(d.getMonth() + 1);
                    setSelectedDate(d);
                }
            }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                <Chip selected={mode === 'day'} onPress={() => setMode('day')} style={styles.chip}>Dag</Chip>
                <Chip selected={mode === 'week'} onPress={() => setMode('week')} style={styles.chip}>Vecka</Chip>
                <Chip selected={mode === 'month'} onPress={() => setMode('month')} style={styles.chip}>Månad</Chip>
                <Chip selected={mode === 'agenda'} onPress={() => setMode('agenda')} style={styles.chip}>Agenda</Chip>
            </View>
        </ScrollView>
    </View>
  );

  const renderTimeGrid = () => (
    <View style={styles.gridWrapper}>
      <ScrollView ref={timeScrollRef} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={styles.hoursCol}>
            {HOURS.map((h) => (
              <View key={h} style={[styles.hourCell, { height: SLOT_HEIGHT }]}>
                <Text style={{ color: theme.colors.onBackground, opacity: 0.6 }}>{String(h).padStart(2, '0')}:00</Text>
              </View>
            ))}
          </View>
          <View style={styles.columns}>
            {days.map((d, idx) => {
              const key = dateKey(d);
              const dayTasks = positioned[key] || [];
              return (
                <View key={idx} style={[styles.dayColumn, { width: columnWidth }]}>
                  {/* Background grid lines */}
                  {HOURS.map((h) => (
                    <TouchableOpacity 
                        key={h} 
                        style={[styles.cell, { height: SLOT_HEIGHT, borderColor: theme.colors.surface }]} 
                        onPress={() => {
                            if (onCreateTask) {
                                const targetDate = new Date(d);
                                targetDate.setHours(h, 0, 0, 0);
                                onCreateTask(targetDate);
                            }
                        }}
                    />
                  ))}

                  {/* Current Time Line */}
                  {isToday(d) && (
                    <View
                      style={{
                        position: 'absolute',
                        top: getCurrentTimePosition(),
                        left: 0,
                        right: 0,
                        height: 2,
                        backgroundColor: 'red',
                        zIndex: 999,
                      }}
                    >
                      <View
                        style={{
                          position: 'absolute',
                          left: -6,
                          top: -4,
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: 'red',
                          zIndex: 1000,
                        }}
                      />
                    </View>
                  )}

                  {dragPreview && dragPreview.dayIndex === idx && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.dropPreview,
                        {
                          top: dragPreview.hourIndex * SLOT_HEIGHT + 2,
                          borderColor: theme.colors.primary,
                        },
                      ]}
                    />
                  )}
                  
                  {/* Day Header (only for Day view inside column, or Week view) */}
                  {mode === 'week' && (
                       <View style={{ position: 'absolute', top: -30, left: 0, right: 0, alignItems: 'center' }}>
                            <Text style={{ fontSize: 10, color: theme.colors.onSurface }}>{DAY_LABELS[idx]}</Text>
                       </View>
                  )}

                  {dayTasks.map((t) => {
                    const parsed = parseDueDate(t.dueDate);
                    if (!parsed) return null;
                    const hour = getTaskHour(t);
                    if (hour === null) return null;
                    const timeLabel = hasExplicitTime(t.dueDate)
                      ? parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '00:00';
                    return (
                      <PanGestureHandler key={t._id} onGestureEvent={onPan(t)} onEnded={onPanEnd(t)}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => onTaskPress(t)}
                          style={[
                            styles.taskCard,
                            {
                              top: hour * SLOT_HEIGHT + 2,
                              backgroundColor: draggingId === t._id ? theme.colors.primary : theme.colors.elevation.level2,
                              borderColor: theme.colors.outline,
                            },
                          ]}
                        >
                          <Text
                            numberOfLines={1}
                            style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                          >
                            {t.title}
                          </Text>
                          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                            {timeLabel}
                          </Text>
                        </TouchableOpacity>
                      </PanGestureHandler>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      
      {mode === 'day' && (
        <>
            <View style={styles.daysRow}>
                <View
                  style={[
                    styles.dayHeader,
                    { width: columnWidth + 64 },
                    dateKey(selectedDate) === todayKey ? { backgroundColor: theme.colors.primary, borderRadius: 8 } : null,
                  ]}
                >
                    <Text style={{ color: dateKey(selectedDate) === todayKey ? theme.colors.onPrimary : theme.colors.onBackground, fontSize: 16, fontWeight: dateKey(selectedDate) === todayKey ? '700' : '400' }}>
                        {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                    </Text>
                </View>
            </View>
            {renderTimeGrid()}
        </>
      )}

      {mode === 'week' && (
        <>
            <View style={[styles.daysRow, { paddingLeft: 64 }]}>
                {days.map((d, idx) => {
                  const isToday = dateKey(d) === todayKey;
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.dayHeader,
                        { width: columnWidth },
                        isToday ? { backgroundColor: theme.colors.primary, borderRadius: 8 } : null,
                      ]}
                    >
                      <Text style={{ color: isToday ? theme.colors.onPrimary : theme.colors.onBackground, fontWeight: isToday ? '700' : '400' }}>{DAY_LABELS[idx]}</Text>
                      <Text style={{ color: isToday ? theme.colors.onPrimary : theme.colors.onBackground, opacity: isToday ? 1 : 0.7, fontWeight: isToday ? '700' : '400' }}>{d.getDate()}</Text>
                    </View>
                  );
                })}
            </View>
            {renderTimeGrid()}
        </>
      )}

      {mode === 'month' && (
          <Calendar
            current={dateKey(selectedDate)}
            onDayPress={(day) => {
                setSelectedDate(new Date(day.timestamp));
                setMode('day'); // Switch to day view on press
            }}
            markedDates={markedDates}
            markingType="custom"
            theme={calendarTheme}
            key={theme.dark ? 'dark' : 'light'} // Force re-render on theme change
          />
      )}

      {mode === 'agenda' && (
          <View style={{ flex: 1 }}>
              <SectionList
                ref={agendaRef}
                sections={agendaSections}
                keyExtractor={(item) => item._id}
                onScrollToIndexFailed={(info) => {
                  const targetIndex = Math.max(0, Math.min(info.highestMeasuredFrameIndex, agendaSections.length - 1));
                  requestAnimationFrame(() => {
                    agendaRef.current?.scrollToLocation({
                      sectionIndex: targetIndex,
                      itemIndex: 0,
                      viewPosition: 0,
                      animated: false,
                    });
                  });
                }}
                renderSectionHeader={({ section }) => (
                  <View
                    style={[
                      styles.agendaSectionHeader,
                      {
                        backgroundColor:
                          section.title === todayKey ? theme.colors.primary : theme.colors.background,
                        borderBottomColor: (theme.colors as any).outlineVariant || theme.colors.outline || 'rgba(0,0,0,0.08)',
                        borderTopColor: (theme.colors as any).outlineVariant || theme.colors.outline || 'rgba(0,0,0,0.08)',
                      },
                    ]}
                  >
                    <Text style={{ color: section.title === todayKey ? theme.colors.onPrimary : theme.colors.onBackground, fontWeight: '700' }}>{formatAgendaHeader(section.title)}</Text>
                  </View>
                )}
                renderItem={({ item }) => {
                  const parsed = parseDueDate(item.dueDate);
                  return (
                    <TouchableOpacity
                      style={[styles.agendaItem, { backgroundColor: theme.colors.surface }]}
                      onPress={() => onTaskPress(item)}
                    >
                      <Text style={{ color: theme.colors.onSurface, fontSize: 16, fontWeight: 'bold' }}>{item.title}</Text>
                      <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        {parsed ? parsed.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                      </Text>
                      <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        {item.completed ? 'Klar' : 'Pågående'}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyDate}>
                    <Text style={{ color: theme.colors.onSurfaceDisabled }}>Inga uppgifter</Text>
                  </View>
                }
              />
          </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  daysRow: { flexDirection: 'row', paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)' },
  dayHeader: { alignItems: 'center', paddingVertical: 6 },
  gridWrapper: { flexDirection: 'row', flex: 1 },
  hoursCol: { width: 64 },
  hourCell: { height: SLOT_HEIGHT, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  columns: { flexDirection: 'row', flex: 1 },
  dayColumn: { borderLeftWidth: 1, position: 'relative', borderLeftColor: 'rgba(0,0,0,0.05)' },
  cell: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  taskCard: {
    position: 'absolute',
    left: 4,
    right: 4,
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    zIndex: 10,
  },
  dropPreview: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: SLOT_HEIGHT - 4,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 6,
    zIndex: 9,
  },
  empty: { padding: 16, alignItems: 'center' },
  chip: { marginRight: 8, height: 32 },
  agendaItem: {
    flex: 1,
    borderRadius: 5,
    padding: 10,
    marginRight: 10,
    marginTop: 17
  },
  agendaSectionHeader: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emptyDate: {
    height: 15,
    flex: 1,
    paddingTop: 30
  }
});
