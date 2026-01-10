import React, { useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, Alert, TouchableOpacity, SectionList } from 'react-native';
import { IconButton, useTheme, Chip, Button } from 'react-native-paper';
import { Task } from '@repo/shared';
import { PanGestureHandler, PanGestureHandlerGestureEvent, ScrollView } from 'react-native-gesture-handler';
import { useStore } from '@/stores/useStore';
import { Calendar } from 'react-native-calendars';

interface TaskTimelineProps {
  tasks: Task[];
  onTaskPress: (task: Task) => void;
  onCreateTask?: (date: Date) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_HEIGHT = 48; // px per hour

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export const TaskTimeline: React.FC<TaskTimelineProps> = ({ tasks, onTaskPress, onCreateTask }) => {
  const theme = useTheme();
  const { updateTask } = useStore();
  const [mode, setMode] = useState<ViewMode>('week');
  const [selectedDate, setSelectedDate] = useState(new Date()); // For Day/Week anchor
  const todayKey = dateKey(new Date());
  
  // State for dragging in TimeGrid
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ taskId: string; dayIndex: number; hourIndex: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ dayIndex: number; hourIndex: number } | null>(null);

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
    if (mode === 'day') return Dimensions.get('window').width - 64; // Minus hour column width
    return Math.floor(Dimensions.get('window').width / 7);
  }, [mode]);

  const positioned = useMemo(() => {
    try {
      const map: Record<string, Task[]> = {};
      for (const day of days) {
        const key = dateKey(day);
        map[key] = [];
      }
      for (const t of tasks) {
        if (!t.dueDate) continue;
        const d = new Date(t.dueDate);
        const key = dateKey(d);
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
      const due = task.dueDate ? new Date(task.dueDate as any) : new Date();
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
      if (t.dueDate) {
        const dateStr = dateKey(new Date(t.dueDate));
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
    const center = new Date(selectedDate);
    center.setHours(0, 0, 0, 0);

    const start = new Date(center);
    start.setDate(start.getDate() - 30);
    const end = new Date(center);
    end.setDate(end.getDate() + 90);

    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const d = new Date(task.dueDate);
      d.setHours(0, 0, 0, 0);
      if (d < start || d > end) continue;
      const key = dateKey(d);
      const current = groups.get(key) || [];
      current.push(task);
      groups.set(key, current);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today >= start && today <= end) {
      const key = dateKey(today);
      if (!groups.has(key)) groups.set(key, []);
    }

    const keys = Array.from(groups.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return keys.map((key) => {
      const data = (groups.get(key) || []).slice().sort((a, b) => {
        const ta = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const tb = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        return ta - tb;
      });
      return { title: key, data };
    });
  }, [tasks, selectedDate]);

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
      <ScrollView style={{ flex: 1 }}>
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
                    const hour = new Date(t.dueDate as any).getHours();
                    return (
                      <PanGestureHandler key={t._id} onGestureEvent={onPan(t)} onEnded={onPanEnd(t)}>
                        <View
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
                            onPress={() => onTaskPress(t)}
                            style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                          >
                            {t.title}
                          </Text>
                          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                            {new Date(t.dueDate as any).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </Text>
                        </View>
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
                sections={agendaSections}
                keyExtractor={(item) => item._id}
                renderSectionHeader={({ section }) => (
                  <View
                    style={[
                      styles.agendaSectionHeader,
                      {
                        backgroundColor:
                          section.title === todayKey ? theme.colors.primary : theme.colors.background,
                      },
                    ]}
                  >
                    <Text style={{ color: section.title === todayKey ? theme.colors.onPrimary : theme.colors.onBackground, fontWeight: '700' }}>{formatAgendaHeader(section.title)}</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.agendaItem, { backgroundColor: theme.colors.surface }]}
                    onPress={() => onTaskPress(item)}
                  >
                    <Text style={{ color: theme.colors.onSurface, fontSize: 16, fontWeight: 'bold' }}>{item.title}</Text>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                      {item.completed ? 'Klar' : 'Pågående'}
                    </Text>
                  </TouchableOpacity>
                )}
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

// --- Utils ---

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

function dateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
}

function formatAgendaHeader(key: string) {
  const [y, m, d] = key.split('-').map((v) => Number(v));
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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
  },
  emptyDate: {
    height: 15,
    flex: 1,
    paddingTop: 30
  }
});
