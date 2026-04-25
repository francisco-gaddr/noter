import { decrypt, encrypt } from './encrypt';

const decryptStringValue = (value: unknown, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  try {
    const decrypted = decrypt(value);
    if (!decrypted && value.trim()) return value;
    return decrypted;
  } catch {
    return value;
  }
};

const parseEncryptedBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return decryptStringValue(value) === 'true';
  }
  return false;
};

const parseEncryptedNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(decryptStringValue(value, value));
    return Number.isFinite(num) ? num : fallback;
  }
  return fallback;
};

const parseReminderOffsets = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? [value] : [0];
  }
  if (typeof value === 'string') {
    const decoded = decryptStringValue(value, value);
    try {
      return parseReminderOffsets(JSON.parse(decoded));
    } catch {
      const asNumber = Number(decoded);
      return Number.isFinite(asNumber) && asNumber >= 0 ? [asNumber] : [0];
    }
  }
  return [0];
};

const materializeNote = (note: any) => {
  const locked = parseEncryptedBoolean(note?.locked);
  return {
    ...note,
    title: locked ? 'Låst anteckning' : decryptStringValue(note?.title),
    content: locked ? '' : decryptStringValue(note?.content),
    tags: locked ? [] : (Array.isArray(note?.tags) ? note.tags.map((tag: string) => decryptStringValue(tag, tag)) : []),
    icon: locked ? undefined : (note?.icon ? decryptStringValue(note.icon, note.icon) : undefined),
    iconColor: locked ? undefined : (note?.iconColor ? decryptStringValue(note.iconColor, note.iconColor) : undefined),
    type: note?.type ? (decryptStringValue(note.type, String(note.type)) as any) : 'note',
    locked,
    order: parseEncryptedNumber(note?.order),
    createdAt: decryptStringValue(note?.createdAt),
    updatedAt: decryptStringValue(note?.updatedAt),
  };
};

const materializeTask = (task: any) => ({
  ...task,
  title: decryptStringValue(task?.title),
  description: decryptStringValue(task?.description),
  dueDate: task?.dueDate ? decryptStringValue(task.dueDate, task.dueDate) : null,
  completed: parseEncryptedBoolean(task?.completed),
  priority: task?.priority ? decryptStringValue(task.priority, 'medium') : 'medium',
  recurrenceType: task?.recurrenceType ? decryptStringValue(task.recurrenceType, 'none') : 'none',
  recurrenceDays: task?.recurrenceDays ? (() => {
    const decoded = decryptStringValue(task.recurrenceDays, task.recurrenceDays);
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded ? decoded.split(',').filter(Boolean) : [];
    }
  })() : [],
  reminderEnabled: parseEncryptedBoolean(task?.reminderEnabled),
  reminderOffsetMinutes: parseReminderOffsets(task?.reminderOffsetMinutes),
  createdAt: decryptStringValue(task?.createdAt),
  updatedAt: decryptStringValue(task?.updatedAt),
  position: parseEncryptedNumber(task?.position),
});

const transformData = (data: any) => {
  if (!data || typeof data !== 'object') return data;
  const next = { ...data };
  if (data.note) next.note = materializeNote(data.note);
  if (Array.isArray(data.notes)) next.notes = data.notes.map(materializeNote);
  if (data.createNote) next.createNote = materializeNote(data.createNote);
  if (data.updateNote) next.updateNote = materializeNote(data.updateNote);
  if (data.task) next.task = materializeTask(data.task);
  if (Array.isArray(data.tasks)) next.tasks = data.tasks.map(materializeTask);
  if (data.createTask) next.createTask = materializeTask(data.createTask);
  if (data.updateTask) next.updateTask = materializeTask(data.updateTask);
  return next;
};

const encryptNoteInput = (input: Record<string, any>) => {
  const next = { ...input };
  if (next.title !== undefined) next.title = encrypt(String(next.title));
  if (next.content !== undefined) next.content = encrypt(String(next.content));
  if (next.tags !== undefined) next.tags = Array.isArray(next.tags) ? next.tags.map((tag: any) => encrypt(String(tag))) : [];
  if (next.locked !== undefined) next.locked = encrypt(String(next.locked));
  if (next.icon !== undefined) next.icon = next.icon ? encrypt(String(next.icon)) : null;
  if (next.iconColor !== undefined) next.iconColor = next.iconColor ? encrypt(String(next.iconColor)) : null;
  if (next.order !== undefined) next.order = encrypt(String(next.order));
  if (next.type !== undefined) next.type = encrypt(String(next.type));
  if (next.createdAt !== undefined) next.createdAt = encrypt(String(next.createdAt));
  if (next.updatedAt !== undefined) next.updatedAt = encrypt(String(next.updatedAt));
  return next;
};

const encryptTaskInput = (input: Record<string, any>) => {
  const next = { ...input };
  if (next.title !== undefined) next.title = encrypt(String(next.title));
  if (next.description !== undefined) next.description = encrypt(String(next.description || ''));
  if (next.dueDate !== undefined) next.dueDate = next.dueDate ? encrypt(String(next.dueDate)) : '';
  if (next.completed !== undefined) next.completed = encrypt(String(next.completed));
  if (next.priority !== undefined) next.priority = encrypt(String(next.priority));
  if (next.position !== undefined) next.position = encrypt(String(next.position));
  if (next.recurrenceType !== undefined) next.recurrenceType = next.recurrenceType ? encrypt(String(next.recurrenceType)) : '';
  if (next.recurrenceDays !== undefined) next.recurrenceDays = next.recurrenceDays ? [encrypt(JSON.stringify(next.recurrenceDays))] : [];
  if (next.reminderEnabled !== undefined) next.reminderEnabled = encrypt(String(next.reminderEnabled));
  if (next.reminderOffsetMinutes !== undefined) next.reminderOffsetMinutes = encrypt(JSON.stringify(next.reminderOffsetMinutes));
  if (next.createdAt !== undefined) next.createdAt = encrypt(String(next.createdAt));
  if (next.updatedAt !== undefined) next.updatedAt = encrypt(String(next.updatedAt));
  return next;
};

export const prepareGraphqlVariables = (query: string, variables: Record<string, any>) => {
  const next = { ...(variables || {}) };
  if (next.input && typeof next.input === 'object') {
    if (/TaskInput/i.test(query)) next.input = encryptTaskInput(next.input);
    else next.input = encryptNoteInput(next.input);
  }
  if (next.type !== undefined) next.type = encrypt(String(next.type));
  if (next.completed !== undefined) next.completed = encrypt(String(next.completed));
  return next;
};

export const parseGraphqlData = <T = any>(data: T): T => transformData(data);
