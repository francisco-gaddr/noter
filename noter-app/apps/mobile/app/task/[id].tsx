import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Alert, ScrollView, Platform } from 'react-native';
import { Appbar, TextInput, Button, SegmentedButtons, HelperText, useTheme, Checkbox, Text } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useStore } from '@/stores/useStore';
import { useStore as useGlobalStore } from '@/stores/useStore';
import { Note } from '@repo/shared';
import { CreateTaskDto, UpdateTaskDto } from '@repo/shared';
import { debounce } from 'lodash';

const schema = yup.object({
  title: yup.string().required('Title is required'),
  description: yup.string().optional(),
  dueDate: yup.date().nullable().optional(),
  priority: yup.mixed<'low' | 'medium' | 'high'>().oneOf(['low', 'medium', 'high']).default('medium'),
  completed: yup.boolean().default(false),
  recurrenceType: yup.mixed<'none' | 'daily' | 'weekly'>().oneOf(['none', 'daily', 'weekly']).default('none'),
  recurrenceDays: yup.array().of(yup.number()).default([]),
}).required();

type FormData = yup.InferType<typeof schema>;

export default function TaskEditorScreen() {
  const { id, parentNoteId: routeParentId, dueDate: routeDueDate } = useLocalSearchParams<{ id: string, parentNoteId?: string, dueDate?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { tasks, createTask, updateTask, deleteTask, notes } = useStore();
  
  const isNew = id === 'new';
  const existingTask = tasks.find(t => t._id === id);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfWeek = (d: Date) => {
    const day = d.getDay(); // 0=Sun
    const daysUntilSunday = (7 - day) % 7;
    const base = startOfDay(d);
    const end = new Date(base);
    end.setDate(base.getDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
    return end;
  };
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [initialized, setInitialized] = useState(false);
  
  const titleInputRef = React.useRef<any>(null); // TextInput from react-native-paper
  const hasFocusedRef = React.useRef(false);

  useEffect(() => {
    if (isNew && !hasFocusedRef.current) {
      const timer = setTimeout(() => {
        // React Native Paper TextInput exposes methods via ref?
        // Actually, it usually forwards ref to native TextInput or has .focus()
        if (titleInputRef.current && typeof titleInputRef.current.focus === 'function') {
            titleInputRef.current.focus();
            hasFocusedRef.current = true;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isNew]);

  const { control, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: yupResolver(schema) as any,
    defaultValues: {
      title: '',
      description: '',
      dueDate: routeDueDate ? new Date(routeDueDate) : null,
      priority: 'medium',
      completed: false,
      recurrenceType: 'none',
      recurrenceDays: [],
    },
  });
  const recurrenceType = watch('recurrenceType');
  const recurrenceDays = watch('recurrenceDays');
  const weekDays = [
    { value: 1, label: 'Mån' },
    { value: 2, label: 'Tis' },
    { value: 3, label: 'Ons' },
    { value: 4, label: 'Tor' },
    { value: 5, label: 'Fre' },
    { value: 6, label: 'Lör' },
    { value: 0, label: 'Sön' },
  ];
  const normalizeDays = (days?: (number | undefined)[]) => (days || []).filter((d): d is number => typeof d === 'number');
  
  const [selectedListId, setSelectedListId] = useState<string | null>(
    typeof routeParentId === 'string' && routeParentId !== 'all' ? routeParentId : null
  );
  const taskLists = (notes || []).filter(n => (n as any).type === 'task_list') as Note[];

  useEffect(() => {
    if (!isNew && existingTask && !initialized) {
      setValue('title', existingTask.title);
      setValue('description', existingTask.description);
      setValue('dueDate', existingTask.dueDate ? new Date(existingTask.dueDate) : null);
      setValue('priority', existingTask.priority);
      setValue('completed', existingTask.completed);
      setValue('recurrenceType', existingTask.recurrenceType || 'none');
      setValue('recurrenceDays', existingTask.recurrenceDays || []);
      setSelectedListId(existingTask.parentNoteId || null);
      setInitialized(true);
    }
  }, [id, existingTask, isNew, setValue, initialized]);

  // Auto-save logic
  const saveTask = async (data: FormData) => {
    if (!data.title) return; // Don't auto-save if invalid

    setIsSaving(true);
    try {
      const dto: UpdateTaskDto = {
        title: data.title,
        description: data.description,
        dueDate: data.dueDate ? data.dueDate.toISOString() : null,
        priority: data.priority,
        completed: data.completed,
        recurrenceType: data.recurrenceType,
        recurrenceDays: data.recurrenceType === 'weekly' ? normalizeDays(data.recurrenceDays) : [],
      };
      await updateTask(id!, dto);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Auto-save task failed', error);
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = useCallback(
    debounce((data: FormData) => {
      saveTask(data);
    }, 1000),
    [id]
  );

  useEffect(() => {
    if (isNew) return; // No auto-save for new tasks

    const subscription = watch((value) => {
      // Cast partial value to FormData if valid, or just pass it and let validation handle?
      // watch returns Partial<FormData>.
      // We should validate before saving? Or just save valid fields?
      // Schema validation handles it.
      // But debounce takes the data.
      debouncedSave(value as FormData);
    });
    return () => subscription.unsubscribe();
  }, [watch, isNew, debouncedSave]);


  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (data: FormData) => {
    if (submitting) return;
    setSubmitting(true);
    
    try {
      if (isNew) {
        const dto: CreateTaskDto = {
          title: data.title,
          description: data.description,
          dueDate: data.dueDate ? data.dueDate.toISOString() : null,
          priority: data.priority,
          completed: data.completed,
          parentNoteId: selectedListId || null,
          recurrenceType: data.recurrenceType,
          recurrenceDays: data.recurrenceType === 'weekly' ? normalizeDays(data.recurrenceDays) : [],
        };
        // await createTask to ensure optimistic update happens before nav
        // and to keep submitting state true
        await createTask(dto);
        router.back();
      } else {
        const dto: UpdateTaskDto = {
          title: data.title,
          description: data.description,
          dueDate: data.dueDate ? data.dueDate.toISOString() : null,
          priority: data.priority,
          completed: data.completed,
          parentNoteId: selectedListId || null,
          recurrenceType: data.recurrenceType,
          recurrenceDays: data.recurrenceType === 'weekly' ? normalizeDays(data.recurrenceDays) : [],
        };
        await updateTask(id!, dto);
        router.back();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
      setSubmitting(false);
    }
  };
  
  const handleSelectList = async (listId: string | null) => {
    setSelectedListId(listId);
    if (!isNew && existingTask) {
      try {
        await updateTask(existingTask._id, { parentNoteId: listId });
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Kunde inte uppdatera lista');
      }
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      'Delete Task',
      'Are you sure you want to delete this task?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await deleteTask(id!);
              router.back();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          }
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content 
          title={isNew ? 'New Task' : 'Edit Task'} 
          subtitle={lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : (isSaving ? 'Saving...' : '')}
        />
        {!isNew && <Appbar.Action icon="delete" onPress={handleDelete} />}
        <Appbar.Action icon="check" onPress={handleSubmit(onSubmit)} disabled={isSubmitting || submitting} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        <Controller
          control={control}
          name="title"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              ref={titleInputRef}
              label="Title"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              error={!!errors.title}
              mode="outlined"
              style={styles.input}
              autoCorrect={false}
              autoComplete="off"
              autoCapitalize="none"
              // autoFocus={isNew} // Handled by useEffect
            />
          )}
        />
        {errors.title && <HelperText type="error">{errors.title.message}</HelperText>}

        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              label="Description"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value || ''}
              multiline
              numberOfLines={3}
              mode="outlined"
              style={styles.input}
              autoCorrect={false}
              autoComplete="off"
              autoCapitalize="none"
            />
          )}
        />

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Due Date & Time</Text>
          <Controller
            control={control}
            name="dueDate"
            render={({ field: { onChange, value } }) => (
              <View>
                {isNew && (
                  <View style={styles.quickDateRow}>
                    <Button
                      mode="outlined"
                      compact
                      onPress={() => onChange(startOfDay(new Date()))}
                    >
                      Idag
                    </Button>
                    <Button
                      mode="outlined"
                      compact
                      onPress={() => {
                        const t = startOfDay(new Date());
                        t.setDate(t.getDate() + 1);
                        onChange(t);
                      }}
                    >
                      Imorgon
                    </Button>
                    <Button
                      mode="outlined"
                      compact
                      onPress={() => onChange(endOfWeek(new Date()))}
                    >
                      Slutet av veckan
                    </Button>
                  </View>
                )}
                <Button 
                  mode="outlined" 
                  onPress={() => setShowDatePicker(true)}
                  icon="calendar"
                >
                  {value ? new Date(value).toLocaleDateString() : 'Set Due Date'}
                </Button>
                {value && (
                  <Button 
                    mode="outlined" 
                    onPress={() => setShowTimePicker(true)} 
                    icon="clock-time-four-outline"
                    style={{ marginTop: 8 }}
                  >
                    {value && (new Date(value).getHours() !== 0 || new Date(value).getMinutes() !== 0)
                      ? new Date(value).toLocaleTimeString()
                      : 'Add Time (optional)'}
                  </Button>
                )}
                {value && (
                  <Button onPress={() => onChange(null)} compact style={{ marginTop: 4 }}>Clear Date</Button>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={value ? new Date(value) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(false);
                      if (selectedDate) {
                        const current = value ? new Date(value) : new Date();
                        const merged = new Date(selectedDate);
                        merged.setHours(current.getHours(), current.getMinutes(), 0, 0);
                        onChange(merged);
                      }
                    }}
                  />
                )}
                {showTimePicker && value && (
                  <DateTimePicker
                    value={new Date(value)}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, selectedTime) => {
                      setShowTimePicker(false);
                      if (selectedTime) {
                        const dateOnly = new Date(value);
                        const merged = new Date(dateOnly);
                        merged.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
                        onChange(merged);
                      }
                    }}
                  />
                )}
              </View>
            )}
          />
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Priority</Text>
          <Controller
            control={control}
            name="priority"
            render={({ field: { onChange, value } }) => (
              <SegmentedButtons
                value={value || 'low'}
                onValueChange={onChange}
                buttons={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            )}
          />
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Återkommande</Text>
          <Controller
            control={control}
            name="recurrenceType"
            render={({ field: { onChange, value } }) => (
              <SegmentedButtons
                value={value || 'none'}
                onValueChange={(next) => {
                  onChange(next);
                  if (next !== 'weekly') {
                    setValue('recurrenceDays', []);
                  }
                }}
                buttons={[
                  { value: 'none', label: 'Ingen' },
                  { value: 'daily', label: 'Dagligen' },
                  { value: 'weekly', label: 'Veckovis' },
                ]}
              />
            )}
          />
          {recurrenceType === 'weekly' && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {weekDays.map((day) => (
                <Button
                  key={day.value}
                  mode={recurrenceDays?.includes(day.value) ? 'contained' : 'outlined'}
                  onPress={() => {
                    const current = Array.isArray(recurrenceDays) ? recurrenceDays : [];
                    const next = current.includes(day.value)
                      ? current.filter(d => d !== day.value)
                      : [...current, day.value];
                    setValue('recurrenceDays', next);
                  }}
                  style={{ marginRight: 8, marginBottom: 8 }}
                >
                  {day.label}
                </Button>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Controller
            control={control}
            name="completed"
            render={({ field: { onChange, value } }) => (
              <View style={styles.checkboxRow}>
                <Checkbox
                  status={value ? 'checked' : 'unchecked'}
                  onPress={() => onChange(!value)}
                />
                <Text onPress={() => onChange(!value)}>Completed</Text>
              </View>
            )}
          />
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Lista</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              mode={selectedListId === null ? 'contained' : 'outlined'}
              onPress={() => handleSelectList(null)}
              style={{ marginRight: 8, marginBottom: 8 }}
            >
              Alla
            </Button>
            {taskLists.map((list) => (
              <Button
                key={list._id}
                mode={selectedListId === list._id ? 'contained' : 'outlined'}
                onPress={() => handleSelectList(list._id)}
                style={{ marginRight: 8, marginBottom: 8 }}
              >
                {list.title || 'Lista'}
              </Button>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  input: {
    marginBottom: 8,
  },
  section: {
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
});
