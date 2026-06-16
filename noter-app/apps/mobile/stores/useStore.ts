import { create } from 'zustand';
import 'react-native-get-random-values';
import * as Crypto from 'expo-crypto';
import { Note, Task, CreateNoteDto, UpdateNoteDto, CreateTaskDto, UpdateTaskDto, encrypt, decrypt, safeDecrypt, parseEntityLinks, serializeEntityLinks, parseNoteSource } from '@repo/shared';
import { fetchWithAuth, login as apiLogin, register as apiRegister, setAuthToken, initApiUrl, setUnauthorizedHandler } from '../services/api';
import * as Database from '../services/database';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleTaskReminder, cancelTaskReminder, cancelAllTaskReminders } from '../services/notifications';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '../services/ai/security';
import { NativeModules } from 'react-native';
import { writeWidgetSnapshot, createNativeWidgetBridge } from '../services/widgets/snapshotWriter';

// Task widget bridge. No-ops until the native widget module ships (see
// Doc/widgets-architecture.md), so calling refreshTaskWidget is always safe.
const widgetBridge = createNativeWidgetBridge((NativeModules as any)?.NoterWidget);
const refreshTaskWidget = (notes: Note[], tasks: Task[]): void => {
  void writeWidgetSnapshot(notes, tasks, widgetBridge, new Date().toISOString()).catch(() => {});
};

let wasOffline = false;

interface AppState {
  notes: Note[];
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  viewMode: 'list' | 'tree';
  isOffline: boolean;
  isSyncingOffline: boolean;
  activeProjectId: string | null;
  token: string | null;
  isInitialized: boolean;
  notificationsEnabled: boolean;
  securityLocked: boolean;
  unlockedProtectedNoteIds: string[];
  
  // UI Actions
  setActiveProject: (id: string | null) => void;
  setViewMode: (mode: 'list' | 'tree') => void;
  /** Optimistically merge a freshly server-created note into state + local DB (for
   *  the AI chat, which creates notes via GraphQL — guarantees instant display even
   *  if the realtime socket event is missed). Idempotent by _id. */
  ingestServerNote: (note: Note) => void;
  ingestServerNoteDeletion: (id: string) => void;
  ingestServerTask: (task: Task) => void;
  ingestServerTaskDeletion: (id: string) => void;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setSecurityLocked: (locked: boolean) => Promise<void>;
  init: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  
  // Socket Actions
  connectSocket: () => void;
  syncViaHttp: () => Promise<void>;

  // Note Actions
  fetchNotes: () => Promise<void>;
  createNote: (data: CreateNoteDto) => Promise<Note>;
  updateNote: (id: string, data: UpdateNoteDto) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  reorderNotes: (notes: Note[]) => Promise<void>;
  
  // Task Actions
  fetchTasks: (parentNoteId?: string) => Promise<void>;
  createTask: (data: CreateTaskDto) => Promise<Task>;
  updateTask: (id: string, data: UpdateTaskDto) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  reorderTasks: (tasks: Task[]) => Promise<void>;
  backgroundRefresh: () => Promise<void>;
  
  // Offline Sync
  syncOfflineChanges: () => Promise<void>;

  // Security
  verifyNoteLock: (id: string, password: string) => Promise<{ title: string; content: string; unlockedId?: string | null }>;
  maskLockedNote: (id: string) => Promise<void>;
  
  // Auth
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
}

// A poison sync item (persistent 5xx/network failure) is dropped after this many
// retries so it can't block everything behind it forever on each reconnect.
const MAX_SYNC_ATTEMPTS = 8;

const processLocalNote = (note: Note): Note => ({
  ...note,
});

const tryDecryptString = (value: unknown): any => {
  if (typeof value !== 'string') return value;
  // safeDecrypt passes plaintext/legacy values through untouched and falls back
  // to the raw value on a decrypt failure, so fields like `type` never collapse
  // to '' (which previously leaked project folders into the notes list).
  return safeDecrypt(value, value);
};

const parseNoteLocked = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    try {
      return decrypt(value) === 'true';
    } catch {
      return false;
    }
  }
  return false;
};

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  let normalized = value.trim().toLowerCase();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'")) || (normalized.startsWith('`') && normalized.endsWith('`'))) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/\s+/g, '_');
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list') return 'task_list';
  if (normalized === 'project' || normalized === 'task_list' || normalized === 'note') return normalized;
  return normalized || 'note';
};

const parseNoteDateValue = (value: unknown): string => {
  if (typeof value !== 'string') return new Date().toISOString();
  // safeDecrypt returns plaintext/legacy ISO strings untouched and decrypts real
  // ciphertext; only truly unusable values fall through to "now".
  const text = safeDecrypt(value, value);
  if (text) return text;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : value;
};

const normalizeEncryptedNote = (note: Note): any => {
  const rawTitle = (note as any).__rawEncryptedTitle ?? note.title;
  const rawContent = (note as any).__rawEncryptedContent ?? note.content;
  const rawTags = (note as any).__rawEncryptedTags ?? (note as any).tags;
  const rawIcon = (note as any).__rawEncryptedIcon ?? (note as any).icon;
  const locked = parseNoteLocked(note.locked);
  return {
  ...note,
  title: typeof rawTitle === 'string' ? rawTitle : '',
  content: typeof rawContent === 'string' ? rawContent : '',
  tags: Array.isArray(rawTags) ? rawTags : (typeof rawTags === 'string' ? [rawTags] : []),
  icon: typeof rawIcon === 'string' ? rawIcon : undefined,
  type: normalizeNoteType((note as any).type ? tryDecryptString((note as any).type) : (note as any).type),
  parentId: note.parentId ? tryDecryptString(note.parentId) : null,
  locked: locked,
  order: (() => {
    const raw = (note as any).order;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      try {
        const decrypted = decrypt(raw);
        const num = Number(decrypted);
        return isNaN(num) ? 0 : num;
      } catch {
        const num = Number(raw);
        return isNaN(num) ? 0 : num;
      }
    }
    return 0;
  })(),
  createdAt: parseNoteDateValue(note.createdAt),
  updatedAt: parseNoteDateValue(note.updatedAt),
  __rawEncryptedTitle: typeof rawTitle === 'string' ? rawTitle : '',
  __rawEncryptedContent: typeof rawContent === 'string' ? rawContent : '',
  __rawEncryptedTags: Array.isArray(rawTags) ? rawTags : rawTags,
  __rawEncryptedIcon: typeof rawIcon === 'string' ? rawIcon : undefined,
  };
};

// Decrypt a single already-normalized note against the security map. This is the
// hot path (AES/GCM per field) — kept as one function so the sync and chunked
// async materializers below share identical decryption semantics.
const materializeOneNote = (note: any, noteMap: any, unlockedIds: Set<string>): Note => {
  const blocking = findBlockingLockedAncestor(note, noteMap as any, unlockedIds);
  if (blocking) {
    const isDirectlyLockedProject = blocking._id === note._id && note.type === 'project';
    let projectTitle = note.title;
    if (isDirectlyLockedProject) {
      projectTitle = safeDecrypt(note.__rawEncryptedTitle || note.title, note.title);
    }
    return {
      ...note,
      title: isDirectlyLockedProject ? projectTitle : 'Låst anteckning',
      content: '',
      tags: [],
      icon: undefined,
      iconColor: undefined,
      locked: true,
    };
  }
  return {
    ...note,
    title: safeDecrypt(note.__rawEncryptedTitle || note.title, note.title),
    content: safeDecrypt(note.__rawEncryptedContent || note.content, note.content),
    tags: Array.isArray(note.__rawEncryptedTags)
      ? note.__rawEncryptedTags.map((t: any) => tryDecryptString(t))
      : (() => {
          if (typeof note.__rawEncryptedTags !== 'string') return [];
          try {
            const decoded = decrypt(note.__rawEncryptedTags);
            const parsed = JSON.parse(decoded);
            return Array.isArray(parsed) ? parsed.map((t: any) => tryDecryptString(t)) : [];
          } catch {
            return [];
          }
        })(),
    icon: note.__rawEncryptedIcon ? tryDecryptString(note.__rawEncryptedIcon) : undefined,
    links: parseEntityLinks(note.links ? safeDecrypt(note.links, '') : ''),
    source: note.source ? parseNoteSource(safeDecrypt(note.source, '')) : null,
    locked: parseNoteLocked(note.locked),
  };
};

const materializeNotesFromEncrypted = (notes: Note[], unlockedIds: Set<string>): Note[] => {
  const normalized = notes.map(normalizeEncryptedNote);
  const noteMap = buildSecurityNoteMap(normalized as any);
  return normalized.map((note: any) => materializeOneNote(note, noteMap, unlockedIds));
};

// Yield to the event loop so a long decrypt batch can't freeze the UI thread.
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Generic chunked map that yields between chunks. Used for task decryption, which
// is a flat per-item transform (no cross-item dependency like the note security map).
const mapInChunks = async <I, O>(
  items: I[],
  fn: (item: I) => O,
  chunkSize = 50,
): Promise<O[]> => {
  if (items.length <= chunkSize) return items.map(fn);
  const out: O[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    for (const item of chunk) out.push(fn(item));
    if (i + chunkSize < items.length) await yieldToEventLoop();
  }
  return out;
};

// Chunked, non-blocking variant for large server payloads. The security map needs
// every note up front (ancestor lock resolution), so normalization stays a single
// cheap pass; only the heavy per-field decryption is sliced into chunks with a
// yield between them — mirrors the web client's CHUNK_SIZE=50 approach so a 1000-
// note sync never blocks scrolling or input on the JS thread.
const MATERIALIZE_CHUNK_SIZE = 50;
const materializeNotesFromEncryptedChunked = async (
  notes: Note[],
  unlockedIds: Set<string>,
): Promise<Note[]> => {
  const normalized = notes.map(normalizeEncryptedNote);
  // Small lists aren't worth the async overhead — decrypt inline.
  if (normalized.length <= MATERIALIZE_CHUNK_SIZE) {
    const noteMap = buildSecurityNoteMap(normalized as any);
    return normalized.map((note: any) => materializeOneNote(note, noteMap, unlockedIds));
  }
  const noteMap = buildSecurityNoteMap(normalized as any);
  const out: Note[] = [];
  for (let i = 0; i < normalized.length; i += MATERIALIZE_CHUNK_SIZE) {
    const chunk = normalized.slice(i, i + MATERIALIZE_CHUNK_SIZE);
    for (const note of chunk) out.push(materializeOneNote(note, noteMap, unlockedIds));
    if (i + MATERIALIZE_CHUNK_SIZE < normalized.length) await yieldToEventLoop();
  }
  return out;
};

const parseTaskCompleted = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    try {
      return decrypt(value) === 'true';
    } catch {
      return Boolean(value);
    }
  }
  return false;
};

const parseTaskPriority = (value: unknown): 'low' | 'medium' | 'high' => {
  const normalize = (v: unknown): 'low' | 'medium' | 'high' => {
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    return 'medium';
  };

  if (typeof value === 'string') {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    try {
      return normalize(decrypt(value));
    } catch {
      return 'medium';
    }
  }

  return 'medium';
};

const getNextRecurringDueDate = (task: Task): string | null => {
  const recurrenceType = task.recurrenceType ?? 'none';
  if (recurrenceType === 'none') return null;

  const base = task.dueDate ? new Date(task.dueDate) : new Date();
  if (recurrenceType === 'daily') {
    const next = new Date(base);
    next.setDate(base.getDate() + 1);
    return next.toISOString();
  }

  if (recurrenceType === 'weekly') {
    const days = Array.isArray(task.recurrenceDays) && task.recurrenceDays.length > 0
      ? task.recurrenceDays
      : [base.getDay()];
    const sorted = [...days].sort((a, b) => a - b);
    const currentDay = base.getDay();
    const nextDay = sorted.find(d => d > currentDay);
    const next = new Date(base);
    if (nextDay === undefined) {
      const first = sorted[0];
      const daysUntil = (7 - currentDay) + first;
      next.setDate(base.getDate() + daysUntil);
    } else {
      next.setDate(base.getDate() + (nextDay - currentDay));
    }
    return next.toISOString();
  }

  return null;
};

const parseReminderOffsets = (value: string): number[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === 'number');
    }
  } catch {
  }
  const num = Number(value);
  if (!Number.isNaN(num)) return [num];
  return [];
};

const processApiTask = (task: any): Task => ({
  ...(task as Task),
  // safeDecrypt keeps legacy/plaintext tasks readable and never blanks a task
  // whose ciphertext fails to decrypt (the cause of empty tasks in the list).
  title: safeDecrypt(task.title, typeof task.title === 'string' ? task.title : ''),
  description: safeDecrypt(task.description, typeof task.description === 'string' ? task.description : ''),
  completed: parseTaskCompleted(task.completed),
  priority: parseTaskPriority(task.priority),
  dueDate: task.dueDate ? (typeof task.dueDate === 'string' ? safeDecrypt(task.dueDate, task.dueDate) : task.dueDate) : null,
  recurrenceType: task.recurrenceType ? (() => { try { return decrypt(task.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
  recurrenceDays: task.recurrenceDays ? (() => { try { return JSON.parse(decrypt(task.recurrenceDays)) } catch { return [] } })() : [],
  reminderEnabled: task.reminderEnabled ? (() => { try { return decrypt(task.reminderEnabled) === 'true' } catch { return false } })() : false,
  reminderOffsetMinutes: task.reminderOffsetMinutes ? (() => { try { return parseReminderOffsets(decrypt(task.reminderOffsetMinutes)); } catch { return []; } })() : [],
  links: parseEntityLinks(task.links ? safeDecrypt(task.links, '') : ''),
  createdAt: safeDecrypt(task.createdAt, typeof task.createdAt === 'string' ? task.createdAt : ''),
  updatedAt: safeDecrypt(task.updatedAt, typeof task.updatedAt === 'string' ? task.updatedAt : ''),
  position: task.position ? (() => {
    try {
      const decryptedPosition = decrypt(String(task.position));
      return decryptedPosition === 'invalid-encrypted-data' ? 0 : Number(decryptedPosition);
    } catch {
      return 0;
    }
  })() : 0,
});

const processLocalTask = (task: Task): Task => ({
  ...task,
  dueDate: task.dueDate ?? null,
  reminderOffsetMinutes: Array.isArray(task.reminderOffsetMinutes) ? task.reminderOffsetMinutes : [],
});

const shouldFallbackToOffline = (error: unknown) => {
  const err = error as any;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = String(err?.message ?? '').toLowerCase();

  const isConnectivity =
    message.includes('could not connect to server') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error');

  const isServer = typeof status === 'number' && status >= 500;
  const isRateLimit = status === 429;

  return isConnectivity || isServer || isRateLimit;
};

export const useStore = create<AppState>((set, get) => ({
  notes: [],
  tasks: [],
  isLoading: false,
  error: null,
  // Default notes view = Kortvy (cards). 'tree' renders the card variant (see NoteList).
  viewMode: 'tree',
  isOffline: false,
  isSyncingOffline: false,
  activeProjectId: null,
  token: null,
  isInitialized: false,
  notificationsEnabled: false,
  securityLocked: false,
  unlockedProtectedNoteIds: [],

  setActiveProject: (id) => {
    set({ activeProjectId: id });
    AsyncStorage.setItem('activeProjectId', id || '').catch(() => {});
  },
  setToken: (token) => {
    set({ token });
    // Also update socket auth
    const socket = getSocket();
    if (socket) {
        (socket as any).auth = token ? { token } : undefined;
        if (socket.connected) {
            socket.disconnect().connect();
        } else if (token) {
            socket.connect();
        }
    }
  },
  setViewMode: (mode) => { set({ viewMode: mode }); AsyncStorage.setItem('notesViewMode', mode).catch(() => {}); },
  ingestServerNote: (note) => set(state => {
    if (!note || !(note as any)._id) return state;
    const merged = [normalizeEncryptedNote(note), ...state.notes];
    const secured = materializeNotesFromEncrypted(merged as any, new Set(state.unlockedProtectedNoteIds));
    const parsed = secured.find((n) => n._id === (note as any)._id);
    if (!parsed) return state;
    if (state.notes.find(n => n._id === parsed._id)) {
      // Already present (e.g. socket beat us) — refresh it in place, keep order.
      Database.saveNoteLocal(parsed, true);
      return { notes: state.notes.map(n => n._id === parsed._id ? parsed : n) };
    }
    Database.saveNoteLocal(parsed, true);
    const deduped = [parsed, ...state.notes].filter((n, idx, arr) => arr.findIndex(x => x._id === n._id) === idx);
    return { notes: deduped };
  }),
  // Mirror the socket handlers so a mutation made BY this device (e.g. an AI tool call over
  // HTTP/GraphQL) updates the local store immediately — no wait for the WSS echo, no reload.
  ingestServerNoteDeletion: (id) => set(state => {
    if (!id) return state;
    Database.deleteNoteLocal(id);
    return { notes: state.notes.filter(n => n._id !== id) };
  }),
  ingestServerTask: (task) => set(state => {
    if (!task || !(task as any)._id) return state;
    const parsed = processApiTask(task);
    Database.saveTaskLocal(parsed, true);
    if (state.tasks.find(t => t._id === parsed._id)) {
      return { tasks: state.tasks.map(t => t._id === parsed._id ? parsed : t) };
    }
    return { tasks: [...state.tasks, parsed] };
  }),
  ingestServerTaskDeletion: (id) => set(state => {
    if (!id) return state;
    Database.deleteTaskLocal(id);
    return { tasks: state.tasks.filter(t => t._id !== id) };
  }),
  setSecurityLocked: async (locked) => {
    if (get().securityLocked === locked) return;
    if (locked) {
      disconnectSocket();
      set({ securityLocked: true, notes: [], tasks: [], activeProjectId: null, isLoading: false, error: null, unlockedProtectedNoteIds: [] });
      return;
    }
    set({ securityLocked: false });
    const token = get().token;
    if (token) {
      await get().fetchNotes();
      await get().fetchTasks();
      get().connectSocket();
    }
  },
  setNotificationsEnabled: async (enabled) => {
    set({ notificationsEnabled: enabled });
    await AsyncStorage.setItem('notificationsEnabled', JSON.stringify(enabled));
    if (!enabled) {
      await cancelAllTaskReminders();
      return;
    }
    const tasks = get().tasks;
    for (const task of tasks) {
      await scheduleTaskReminder(task);
    }
  },

  init: async () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    await initApiUrl();
    await Database.initDatabase();

    const storedToken = await SecureStore.getItemAsync('token');
    const storedNotifications = await AsyncStorage.getItem('notificationsEnabled');
    const storedActiveProjectId = await AsyncStorage.getItem('activeProjectId');
    const storedViewMode = await AsyncStorage.getItem('notesViewMode');
    if (storedNotifications !== null) {
      set({ notificationsEnabled: storedNotifications === 'true' });
    }
    if (storedActiveProjectId && storedActiveProjectId !== 'null') {
      set({ activeProjectId: storedActiveProjectId });
    }
    // Restore the last-used notes view; default stays 'tree' (cards) when unset.
    if (storedViewMode === 'list' || storedViewMode === 'tree') {
      set({ viewMode: storedViewMode });
    }
    if (storedToken) {
      setAuthToken(storedToken);
      set({ token: storedToken });
    }

    setUnauthorizedHandler(async () => {
      await get().logout();
    });
    
    // Load local data immediately
    if (!get().securityLocked) {
      const localNotes = await Database.getNotesLocal();
      const localTasks = await Database.getTasksLocal();
      set({
        notes: localNotes.map(processLocalNote),
        tasks: localTasks.map(processLocalTask)
      });
    }

    // Setup network listener
    NetInfo.addEventListener(state => {
      const isOffline = !state.isConnected;
      set({ isOffline });
      if (!isOffline) {
        if (wasOffline) {
          get().fetchNotes();
          get().fetchTasks();
        }
        wasOffline = false;
        get().syncOfflineChanges();
      } else {
        wasOffline = true;
      }
    });

    if (storedToken && !get().securityLocked) {
      await get().fetchNotes();
      await get().fetchTasks();
      get().connectSocket();
    } else if (!get().securityLocked) {
      get().connectSocket();
    }
  },

  // Fallback sync method when WebSocket fails
  syncViaHttp: async () => {
    if (get().securityLocked) return;
    try {
      console.log('Attempting HTTP sync fallback due to WebSocket issues');
      await get().fetchNotes();
      await get().fetchTasks();
      console.log('HTTP sync fallback completed successfully');
    } catch (error) {
      console.error('HTTP sync fallback failed:', error);
    }
  },

  connectSocket: () => {
    if (get().securityLocked) {
      disconnectSocket();
      return;
    }
    const token = get().token;
    const socket = initSocket(token);

    if (!socket) {
      console.log('Socket initialization failed');
      return;
    }

    // Add connection state monitoring
    const checkConnection = () => {
      const status = (socket as any).connected ? 'connected' : 'disconnected';
      console.log(`Socket status: ${status}`);
      
      if (!(socket as any).connected) {
        console.log('Socket not connected, will retry sync operations');
      }
    };

    // Monitor connection state
    setTimeout(checkConnection, 2000); // Check after 2 seconds

    // Clear existing listeners to avoid duplicates if reconnecting
    socket.off('note:created');
    socket.off('note:updated');
    socket.off('note:deleted');
    socket.off('notes:reordered');
    socket.off('task:created');
    socket.off('task:updated');
    socket.off('task:deleted');
    socket.off('tasks:reordered');
    socket.off('cache:invalidate');
    let cacheInvalidateTimer: ReturnType<typeof setTimeout> | null = null;

    socket.on('note:created', (note: Note) => {
      set(state => {
        const merged = [normalizeEncryptedNote(note), ...state.notes];
        const secured = materializeNotesFromEncrypted(merged as any, new Set(state.unlockedProtectedNoteIds));
        const parsed = secured.find((n) => n._id === note._id);
        if (!parsed) return state;
        if (state.notes.find(n => n._id === parsed._id)) return state;

        const parsedClientId = (parsed as any).clientId as string | undefined;
        const existingIdxByClientId =
          parsedClientId
            ? state.notes.findIndex(n => (n as any).clientId && (n as any).clientId === parsedClientId)
            : -1;

        if (existingIdxByClientId !== -1) {
          const existing = state.notes[existingIdxByClientId];
          if (existing && existing._id !== parsed._id) {
            Database.deleteNoteLocal(existing._id);
          }
          const replaced = state.notes.map((n, idx) => (idx === existingIdxByClientId ? parsed : n));
          const deduped = replaced.filter((n, idx, arr) => arr.findIndex(x => x._id === n._id) === idx);
          Database.saveNoteLocal(parsed, true);
          return { notes: deduped };
        }

        Database.saveNoteLocal(parsed, true);
        const deduped = [parsed, ...state.notes].filter((n, idx, arr) => arr.findIndex(x => x._id === n._id) === idx);
        return { notes: deduped };
      });
    });

    socket.on('note:updated', (note: Note) => {
      set(state => {
        const merged = state.notes.map((n) => (n._id === note._id ? normalizeEncryptedNote(note) : n));
        const secured = materializeNotesFromEncrypted(merged as any, new Set(state.unlockedProtectedNoteIds));
        const parsed = secured.find((n) => n._id === note._id);
        if (!parsed) return state;
        Database.saveNoteLocal(parsed, true);
        return {
          notes: secured
        };
      });
    });

    socket.on('note:deleted', (id: string) => {
      set(state => {
        Database.deleteNoteLocal(id);
        return {
          notes: state.notes.filter(n => n._id !== id)
        };
      });
    });

    socket.on('notes:reordered', (reorderedNotes: { _id: string; order: any }[]) => {
      set(state => {
        const newNotes = state.notes.map(n => {
          const update = reorderedNotes.find(rn => rn._id === n._id);
          if (update) {
            let nextOrder = 0;
            if (typeof update.order === 'number') {
              nextOrder = update.order;
            } else if (typeof update.order === 'string') {
              try {
                const decrypted = decrypt(update.order);
                const num = Number(decrypted);
                nextOrder = isNaN(num) ? 0 : num;
              } catch {
                const num = Number(update.order);
                nextOrder = isNaN(num) ? 0 : num;
              }
            }
            const updated = { ...n, order: nextOrder } as any;
            Database.saveNoteLocal(updated, true);
            return updated;
          }
          return n;
        });
        return { notes: newNotes };
      });
    });

    socket.on('task:created', (task: Task) => {
      const parsed = processApiTask(task);
      set(state => {
        if (state.tasks.find(t => t._id === parsed._id)) return state;
        Database.saveTaskLocal(parsed, true);
        return { tasks: [...state.tasks, parsed] };
      });
    });

    socket.on('task:updated', (task: Task) => {
      const parsed = processApiTask(task);
      set(state => {
        Database.saveTaskLocal(parsed, true);
        return {
          tasks: state.tasks.map(t => t._id === parsed._id ? parsed : t)
        };
      });
    });

    socket.on('task:deleted', (id: string) => {
      set(state => {
        Database.deleteTaskLocal(id);
        return {
          tasks: state.tasks.filter(t => t._id !== id)
        };
      });
    });

    socket.on('tasks:reordered', (reorderedTasks: { _id: string; position: any }[]) => {
      set(state => {
        const newTasks = state.tasks.map(t => {
          const update = reorderedTasks.find(rt => rt._id === t._id);
          if (update) {
            let nextPosition = 0;
            try {
              const decrypted = decrypt(String(update.position));
              const num = Number(decrypted);
              nextPosition = isNaN(num) ? 0 : num;
            } catch {
              nextPosition = 0;
            }
            const updated = { ...t, position: nextPosition };
            Database.saveTaskLocal(updated, true);
            return updated;
          }
          return t;
        });
        return { tasks: newTasks };
      });
    });

    // Change-stream fallback: any DB write the user owns emits cache:invalidate.
    // Coalesce bursts and refetch so AI-agent / other-device writes that didn't arrive
    // as a specific note:created/task:created event still appear live (no reload).
    socket.on('cache:invalidate', () => {
      if (cacheInvalidateTimer) clearTimeout(cacheInvalidateTimer);
      cacheInvalidateTimer = setTimeout(() => { void get().syncViaHttp(); }, 600);
    });

    socket.on('connect', () => {
      get().syncViaHttp();
    });
  },

  login: async (username, password) => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiLogin(username, password);
      setAuthToken(response.token);
      await SecureStore.setItemAsync('token', response.token);
      // Remember the username (used e.g. to pre-seed a user's private AI providers).
      try { await SecureStore.setItemAsync('auth_username', username); } catch {}
      get().setToken(response.token);
      if (get().securityLocked) {
        await get().setSecurityLocked(false);
      }
      await get().init();
      await get().fetchNotes();
      await get().fetchTasks();
      get().connectSocket();
    } catch (error: any) {
      set({ error: error.message || 'Login failed' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (username: string, password: string) => {
    try {
      set({ isLoading: true, error: null });
      await apiRegister(username, password);
      // Automatically login after register
      await get().login(username, password);
    } catch (error: any) {
      set({ error: error.message || 'Registration failed' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync('token');
    } catch {}
    setAuthToken(null);
    disconnectSocket();
    set({ token: null, notes: [], tasks: [], activeProjectId: null, error: null, unlockedProtectedNoteIds: [] });
  },

  fetchNotes: async () => {
    if (get().securityLocked) {
      set({ isLoading: false });
      return;
    }
    const unlocked = () => new Set(get().unlockedProtectedNoteIds);

    // 1) Offline-first: paint local data immediately. Show the spinner only on a
    //    genuinely empty cold start, so a returning user never waits on the net.
    try {
      const localNotes = await Database.getNotesLocal();
      const securedLocal = materializeNotesFromEncrypted(localNotes.map(processLocalNote) as any, unlocked());
      set({ notes: securedLocal, isLoading: securedLocal.length === 0, error: null });
    } catch {
      /* fall through to the network refresh */
    }

    // 2) Background refresh from the server — never blocks the rendered list.
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        set({ isLoading: false });
        return;
      }
      const notes = await fetchWithAuth('/notes');
      const safeNotes = Array.isArray(notes) ? notes : [];
      // Chunked decrypt so a large sync doesn't freeze the UI thread.
      const securedNotes = await materializeNotesFromEncryptedChunked(safeNotes as any, unlocked());
      set({ notes: securedNotes, isLoading: false });
      // Persist the snapshot in a single transaction, off the render path.
      void Database.saveNotesLocalBulk(securedNotes).catch(() => {});
    } catch (error: any) {
      console.error('[Store] Fetch notes error:', error);
      set({ isLoading: false, error: error.message });
    }
  },

  createNote: async (data) => {
    // Optimistic Update
    set({ isLoading: true, error: null });
    
    const tempId = `local_${Date.now()}`;
    const clientId = Crypto.randomUUID(); // Generate clientId for potential backend dedupe if supported, or just local consistency

    const optimisticNote: Note = {
      _id: tempId,
      userId: 'me',
      title: data.title,
      content: data.content,
      tags: data.tags ?? [],
      parentId: data.parentId ?? null,
      locked: data.locked ?? false,
      icon: data.icon,
      order: data.order,
      type: data.type || 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clientId, 
    };

    // 1. Update State immediately
    set((state) => ({
        notes: [optimisticNote, ...state.notes],
        isLoading: false
    }));

    try {
      // 2. Save Local (unsynced)
      await Database.saveNoteLocal(optimisticNote, false);

      // 3. Encrypt
      const encryptedData = {
        ...data,
        title: encrypt(data.title),
        content: encrypt(data.content),
        type: encrypt(data.type || 'note'),
        locked: encrypt(String(data.locked || false)),
        links: (data as any).links && (data as any).links.length ? encrypt(serializeEntityLinks((data as any).links)) : undefined,
        source: (data as any).source ? encrypt(JSON.stringify((data as any).source)) : undefined,
        order: data.order !== undefined ? encrypt(String(data.order)) : undefined,
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        clientId, // Send it anyway
      };

      // 4. Try Sync
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const created = await fetchWithAuth('/notes', {
            method: 'POST',
            body: JSON.stringify(encryptedData),
          });
          const realNote = materializeNotesFromEncrypted([created as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
          
          // Replace in State
          set((state) => ({
            notes: state.notes.map(n => n._id === tempId ? realNote : n)
          }));

          // Replace in DB
          await Database.deleteNoteLocal(tempId);
          await Database.saveNoteLocal(realNote, true);
          
          return realNote;
        } catch (error) {
           if (!shouldFallbackToOffline(error)) throw error;
           await Database.addToSyncQueue('CREATE', 'NOTE', { ...encryptedData, tempId });
           return optimisticNote;
        }
      } else {
        await Database.addToSyncQueue('CREATE', 'NOTE', { ...encryptedData, tempId });
        return optimisticNote;
      }
    } catch (error: any) {
      set((state) => ({
        notes: state.notes.filter(n => n._id !== tempId),
        error: error.message,
        isLoading: false
      }));
      throw error;
    }
  },

  updateNote: async (id, data) => {
    // Optimistic Update
    set({ isLoading: true, error: null });
    
    // 1. Get current note
    const state = get();
    const currentNote = state.notes.find(n => n._id === id);
    if (!currentNote) throw new Error('Note not found');

    const optimisticNote: Note = {
        ...currentNote,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.locked !== undefined ? { locked: typeof data.locked === 'string' ? data.locked === 'true' : data.locked } : {}),
        ...(data.password !== undefined ? { password: data.password } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        updatedAt: new Date().toISOString()
    };
    if (data.locked === true) {
        const existingRawTitle = (currentNote as any).__rawEncryptedTitle;
        const existingRawContent = (currentNote as any).__rawEncryptedContent;
        const existingRawTags = (currentNote as any).__rawEncryptedTags;
        const existingRawIcon = (currentNote as any).__rawEncryptedIcon;
        (optimisticNote as any).__rawEncryptedTitle = existingRawTitle || encrypt(currentNote.title || '');
        (optimisticNote as any).__rawEncryptedContent = existingRawContent || encrypt(currentNote.content || '');
        (optimisticNote as any).__rawEncryptedTags = existingRawTags || encrypt(JSON.stringify(currentNote.tags || []));
        (optimisticNote as any).__rawEncryptedIcon = existingRawIcon || (currentNote.icon ? encrypt(currentNote.icon) : undefined);
        optimisticNote.title = 'Låst anteckning';
        optimisticNote.content = '';
        set((state) => ({ unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((item) => item !== id) }));
    }

    // 2. Update State
    set(state => ({
        notes: state.notes.map(n => n._id === id ? optimisticNote : n),
        isLoading: false
    }));

    try {
      // 3. Save Local
      await Database.saveNoteLocal(optimisticNote, false);

      // 4. Encrypt
      const encryptedData: any = { ...data };
      if (data.title !== undefined) encryptedData.title = encrypt(data.title);
      if (data.content !== undefined) encryptedData.content = encrypt(data.content);
      if (data.tags !== undefined) encryptedData.tags = data.tags.map((t: string) => encrypt(t));
      if (data.icon !== undefined) encryptedData.icon = data.icon ? encrypt(data.icon) : '';
      if (data.type !== undefined) encryptedData.type = encrypt(data.type);
      if (data.locked !== undefined) encryptedData.locked = encrypt(String(data.locked));
      if (data.order !== undefined) encryptedData.order = encrypt(String(data.order));
      if (data.password !== undefined) encryptedData.password = data.password;
      if ((data as any).links !== undefined) encryptedData.links = (data as any).links && (data as any).links.length ? encrypt(serializeEntityLinks((data as any).links)) : '';
      if ((data as any).source !== undefined) encryptedData.source = (data as any).source ? encrypt(JSON.stringify((data as any).source)) : '';
      // Always update updatedAt
      encryptedData.updatedAt = encrypt(new Date().toISOString());

      // 5. Try Sync
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const updated = await fetchWithAuth(`/notes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(encryptedData),
          });
          const realNote = materializeNotesFromEncrypted([updated as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
          
          // Update State & DB
          set(state => ({
              notes: materializeNotesFromEncrypted(state.notes.map(n => n._id === id ? realNote : n) as any, new Set(state.unlockedProtectedNoteIds))
          }));
          await Database.saveNoteLocal(realNote, true);

          return realNote;
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('UPDATE', 'NOTE', { id, ...encryptedData });
          return optimisticNote;
        }
      } else {
         await Database.addToSyncQueue('UPDATE', 'NOTE', { id, ...encryptedData });
         return optimisticNote;
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteNote: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const netState = await NetInfo.fetch();
      
      if (netState.isConnected) {
        try {
          await fetchWithAuth(`/notes/${id}`, {
            method: 'DELETE',
          });
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('DELETE', 'NOTE', { id });
        }
      } else {
        await Database.addToSyncQueue('DELETE', 'NOTE', { id });
      }
      
      await Database.deleteNoteLocal(id);

      set((state) => ({
        notes: state.notes.filter((n) => n._id !== id),
        isLoading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  reorderNotes: async (notes) => {
    set(state => {
      const newNotesMap = new Map(notes.map((n, i) => [n._id, { order: i, parentId: n.parentId }]));
      const updatedNotes = state.notes.map(n => {
        if (newNotesMap.has(n._id)) {
            const update = newNotesMap.get(n._id)!;
            return { ...n, order: update.order, parentId: update.parentId ?? n.parentId };
        }
        return n;
      });
      return { notes: updatedNotes };
    });
    try {
      const payload = notes.map((n, index) => ({ _id: n._id, order: encrypt(String(index)), parentId: n.parentId }));
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          await fetchWithAuth('/notes/reorder', {
            method: 'PUT',
            body: JSON.stringify({ notes: payload }),
          });
          for (const note of notes) {
              await Database.saveNoteLocal({ ...note, order: notes.indexOf(note) }, true);
          }
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('REORDER', 'NOTE', { notes: payload });
          for (const note of notes) {
              await Database.saveNoteLocal({ ...note, order: notes.indexOf(note) }, false);
          }
        }
      } else {
        await Database.addToSyncQueue('REORDER', 'NOTE', { notes: payload });
        for (const note of notes) {
            await Database.saveNoteLocal({ ...note, order: notes.indexOf(note) }, false);
        }
      }
    } catch (error) {
      console.error('Reorder notes failed', error);
    }
  },

  fetchTasks: async (parentNoteId) => {
    if (get().securityLocked) {
      set({ isLoading: false });
      return;
    }

    // Reminder scheduling is fire-and-forget so it never sequence-blocks render.
    const scheduleReminders = (tasks: Task[]) => {
      if (!get().notificationsEnabled) return;
      void (async () => {
        for (const task of tasks) {
          try { await scheduleTaskReminder(task); } catch { /* non-fatal */ }
        }
      })();
    };

    // 1) Offline-first: paint local tasks immediately (spinner only when empty).
    try {
      const localTasks = await Database.getTasksLocal();
      const filtered = parentNoteId ? localTasks.filter(t => t.parentNoteId === parentNoteId) : localTasks;
      const mapped = filtered.map(processLocalTask);
      set({ tasks: mapped, isLoading: mapped.length === 0, error: null });
      scheduleReminders(mapped);
    } catch {
      /* fall through to the network refresh */
    }

    // 2) Background refresh from the server.
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        set({ isLoading: false });
        return;
      }
      const url = parentNoteId ? `/tasks?parentNoteId=${encodeURIComponent(parentNoteId)}` : '/tasks';
      const tasks = await fetchWithAuth(url);
      // Chunked decrypt so a large sync doesn't freeze the UI thread.
      const decryptedTasks = await mapInChunks(Array.isArray(tasks) ? tasks : [], processApiTask);

      // Keep local-only (unsynced) tasks, deduped by clientId against the server set.
      const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
      const localOnlyTasks = get().tasks.filter(
        (t) => t._id.startsWith('local_task_') && !serverClientIds.has(t.clientId),
      );
      const mergedTasks = [...decryptedTasks, ...localOnlyTasks];

      set({ tasks: mergedTasks, isLoading: false });
      void Database.saveTasksLocalBulk(decryptedTasks).catch(() => {});
      scheduleReminders(mergedTasks);
      refreshTaskWidget(get().notes, mergedTasks);
    } catch (error: any) {
      set({ isLoading: false, error: error.message });
    }
  },

  backgroundRefresh: async () => {
    if (get().securityLocked) return;
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) return;

      const notes = await fetchWithAuth('/notes');
      const safeNotes = Array.isArray(notes) ? notes : [];
      const decryptedNotes = await materializeNotesFromEncryptedChunked(safeNotes as any, new Set(get().unlockedProtectedNoteIds));
      for (const note of decryptedNotes) {
        await Database.saveNoteLocal(note, true);
      }
      set({ notes: decryptedNotes });

      const tasks = await fetchWithAuth('/tasks');
      const decryptedTasks = await mapInChunks(Array.isArray(tasks) ? tasks : [], processApiTask);
      for (const task of decryptedTasks) {
        await Database.saveTaskLocal(task, true);
      }
      const state = get();
      const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
      const localOnlyTasks = state.tasks.filter(t => t._id.startsWith('local_task_') && !serverClientIds.has((t as any).clientId));
      const mergedTasks = [...decryptedTasks, ...localOnlyTasks];
      set({ tasks: mergedTasks });
      if (get().notificationsEnabled) {
        for (const task of mergedTasks) {
          await scheduleTaskReminder(task);
        }
      }
    } catch (error) {
      console.error('Background refresh failed', error);
    }
  },

  createTask: async (data) => {
    // Optimistic Update Pattern
    set({ isLoading: true, error: null });
    const clientId = Crypto.randomUUID();
    const tempId = `local_task_${Date.now()}`;
    
    // 1. Prepare optimistic task
    const reminderOffsets = data.reminderEnabled
      ? (Array.isArray(data.reminderOffsetMinutes) && data.reminderOffsetMinutes.length > 0 ? data.reminderOffsetMinutes : [0])
      : [];
    const optimisticTask: Task = {
      _id: tempId,
      userId: 'me', // Placeholder, will be replaced by backend or ignored locally
      title: data.title,
      description: data.description || '',
      dueDate: data.dueDate ?? null,
      completed: data.completed || false,
      priority: data.priority || 'medium',
      parentNoteId: data.parentNoteId ?? undefined,
      position: data.position ?? 0,
      recurrenceType: data.recurrenceType ?? 'none',
      recurrenceDays: data.recurrenceDays ?? [],
      reminderEnabled: data.reminderEnabled ?? false,
      reminderOffsetMinutes: reminderOffsets,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clientId, 
    };

    // 2. Update State immediately
    set((state) => ({
      tasks: [optimisticTask, ...state.tasks],
      isLoading: false 
    }));

    try {
      // 3. Save to Local DB
      await Database.saveTaskLocal(optimisticTask, false);
      if (get().notificationsEnabled) {
        await scheduleTaskReminder(optimisticTask);
      }

      // 4. Encrypt for Sync/Queue
      const encryptedData = {
        ...data,
        title: encrypt(data.title),
        description: data.description ? encrypt(data.description) : '',
        completed: encrypt(String(data.completed || false)),
        priority: encrypt(data.priority || 'medium'),
        dueDate: data.dueDate ? encrypt(new Date(data.dueDate).toISOString()) : '',
        recurrenceType: data.recurrenceType ? encrypt(data.recurrenceType) : '',
        recurrenceDays: data.recurrenceDays ? encrypt(JSON.stringify(data.recurrenceDays)) : '',
        reminderEnabled: data.reminderEnabled !== undefined ? encrypt(String(data.reminderEnabled)) : '',
        reminderOffsetMinutes: data.reminderEnabled ? encrypt(JSON.stringify(reminderOffsets)) : '',
        links: (data as any).links && (data as any).links.length ? encrypt(serializeEntityLinks((data as any).links)) : '',
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        position: data.position !== undefined ? encrypt(String(data.position)) : encrypt('0'),
        clientId,
      };

      // 5. Try Sync if Online
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const created = await fetchWithAuth('/tasks', {
            method: 'POST',
            body: JSON.stringify(encryptedData),
          });
          
          // Success: Replace temp with real
          const realTask = processApiTask(created);
          
          // Update State
          set((state) => {
            // Check if realTask is already in the list (e.g. from background sync)
            const exists = state.tasks.some(t => t._id === realTask._id);
            if (exists) {
                // If it exists, we just remove the optimistic task to avoid duplicates
                return {
                    tasks: state.tasks.filter(t => t._id !== tempId)
                };
            }
            return {
              tasks: state.tasks.map(t => t._id === tempId ? realTask : t)
            };
          });

          // Update DB
          await Database.deleteTaskLocal(tempId);
          await Database.saveTaskLocal(realTask, true);
          if (get().notificationsEnabled) {
            await cancelTaskReminder(tempId);
            await scheduleTaskReminder(realTask);
          }

          return realTask;
        } catch (error) {
          // Sync failed, fallback to queue
          if (!shouldFallbackToOffline(error)) throw error; 
          
          await Database.addToSyncQueue('CREATE', 'TASK', { ...encryptedData, tempId });
          return optimisticTask;
        }
      } else {
        // Offline
        await Database.addToSyncQueue('CREATE', 'TASK', { ...encryptedData, tempId });
        return optimisticTask;
      }
    } catch (error: any) {
      // If local save fails, we have a problem. Revert state?
      set((state) => ({
        tasks: state.tasks.filter(t => t._id !== tempId),
        error: error.message,
        isLoading: false
      }));
      throw error;
    }
  },

  updateTask: async (id, data) => {
    // Optimistic Update
    set({ isLoading: true, error: null });

    // 1. Get current task to create optimistic version
    const state = get();
    const currentTask = state.tasks.find((t) => t._id === id);
    if (!currentTask) {
      throw new Error('Task not found');
    }

    const optimisticTask = { ...currentTask };
    if (data.title !== undefined) optimisticTask.title = data.title;
    if (data.description !== undefined) optimisticTask.description = data.description;
    if (data.completed !== undefined) optimisticTask.completed = data.completed;
    if (data.priority !== undefined) optimisticTask.priority = data.priority;
    if (data.dueDate !== undefined) optimisticTask.dueDate = data.dueDate;
    if (data.position !== undefined) optimisticTask.position = data.position;
    if (data.parentNoteId !== undefined) optimisticTask.parentNoteId = data.parentNoteId;
    if (data.recurrenceType !== undefined) optimisticTask.recurrenceType = data.recurrenceType;
    if (data.recurrenceDays !== undefined) optimisticTask.recurrenceDays = data.recurrenceDays;
    if (data.reminderEnabled !== undefined) optimisticTask.reminderEnabled = data.reminderEnabled;
    if (data.reminderOffsetMinutes !== undefined) {
      optimisticTask.reminderOffsetMinutes = Array.isArray(data.reminderOffsetMinutes) ? data.reminderOffsetMinutes : [];
    }
    optimisticTask.updatedAt = new Date().toISOString();

    const shouldCreateNext = data.completed === true && !currentTask.completed;
    if (shouldCreateNext && optimisticTask.recurrenceType && optimisticTask.recurrenceType !== 'none') {
      const nextDueDate = getNextRecurringDueDate(optimisticTask);
      if (nextDueDate) {
        await get().createTask({
          title: optimisticTask.title,
          description: optimisticTask.description,
          dueDate: nextDueDate,
          priority: optimisticTask.priority,
          completed: false,
          parentNoteId: optimisticTask.parentNoteId,
          recurrenceType: optimisticTask.recurrenceType,
          recurrenceDays: optimisticTask.recurrenceDays,
          reminderEnabled: optimisticTask.reminderEnabled,
          reminderOffsetMinutes: optimisticTask.reminderOffsetMinutes,
        });
      }
    }

    // 2. Update State immediately
    set((state) => ({
      tasks: state.tasks.map((t) => (t._id === id ? optimisticTask : t)),
      isLoading: false,
    }));
    if (get().notificationsEnabled) {
      await scheduleTaskReminder(optimisticTask);
    }

    try {
      // 3. Encrypt Data
      const encryptedData = { ...data } as any;
      const toIso = (value: unknown) => {
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'string') return value;
        return String(value ?? '');
      };

      if (data.title !== undefined) encryptedData.title = encrypt(data.title);
      if (data.description !== undefined) encryptedData.description = encrypt(data.description || '');
      if (data.completed !== undefined) encryptedData.completed = encrypt(String(data.completed));
      if (data.priority !== undefined) encryptedData.priority = encrypt(data.priority);
      if (data.dueDate !== undefined) {
        encryptedData.dueDate = data.dueDate ? encrypt(toIso(data.dueDate)) : '';
      }
      if (data.recurrenceType !== undefined) {
        encryptedData.recurrenceType = data.recurrenceType ? encrypt(data.recurrenceType) : '';
      }
      if (data.recurrenceDays !== undefined) {
        encryptedData.recurrenceDays = data.recurrenceDays ? encrypt(JSON.stringify(data.recurrenceDays)) : '';
      }
      if (data.reminderEnabled !== undefined) {
        encryptedData.reminderEnabled = encrypt(String(data.reminderEnabled));
      }
      if (data.reminderOffsetMinutes !== undefined || data.reminderEnabled !== undefined) {
        const offsets = data.reminderEnabled
          ? (Array.isArray(data.reminderOffsetMinutes) && data.reminderOffsetMinutes.length > 0 ? data.reminderOffsetMinutes : [0])
          : [];
        encryptedData.reminderOffsetMinutes = offsets.length > 0 ? encrypt(JSON.stringify(offsets)) : '';
      }
      if ((data as any).links !== undefined) encryptedData.links = (data as any).links && (data as any).links.length ? encrypt(serializeEntityLinks((data as any).links)) : '';
      encryptedData.updatedAt = encrypt(new Date().toISOString());
      if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));

      // 4. Save Local (mark as unsynced initially)
      await Database.saveTaskLocal(optimisticTask, false);

      // 5. Try Sync
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const updated = await fetchWithAuth(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(encryptedData),
          });
          const realTask = processApiTask(updated);

          // Update State & DB with confirmed data
          set((state) => ({
            tasks: state.tasks.map((t) => (t._id === id ? realTask : t)),
          }));
          await Database.saveTaskLocal(realTask, true);
          if (get().notificationsEnabled) {
            await scheduleTaskReminder(realTask);
          }

          return realTask;
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('UPDATE', 'TASK', { id, ...encryptedData });
          return optimisticTask;
        }
      } else {
        await Database.addToSyncQueue('UPDATE', 'TASK', { id, ...encryptedData });
        return optimisticTask;
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteTask: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          await fetchWithAuth(`/tasks/${id}`, {
            method: 'DELETE',
          });
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('DELETE', 'TASK', { id });
        }
      } else {
        await Database.addToSyncQueue('DELETE', 'TASK', { id });
      }
      
      await Database.deleteTaskLocal(id);
      if (get().notificationsEnabled) {
        await cancelTaskReminder(id);
      }

      set((state) => ({
        tasks: state.tasks.filter((t) => t._id !== id),
        isLoading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },
  
  // Utility: delete tasks that are not linked to any list
  // Use with caution; called explicitly from UI if requested
  deleteOrphanTasks: async () => {
    try {
      const state = get();
      const orphans = state.tasks.filter(t => !t.parentNoteId);
      if (orphans.length === 0) return;
      console.log(`[Store] Deleting ${orphans.length} orphan tasks`);
      for (const t of orphans) {
        await get().deleteTask(t._id);
      }
    } catch (e) {
      console.log('[Store] Failed to delete orphan tasks', e);
    }
  },

  reorderTasks: async (tasks) => {
    const currentTasks = get().tasks;
    const groupKeyForTask = (t: Task) => (t.parentNoteId ?? '__null__') as string;
    const grouped = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = groupKeyForTask(t);
      const arr = grouped.get(key);
      if (arr) arr.push(t);
      else grouped.set(key, [t]);
    }

    const compareTasks = (a: Task, b: Task) => {
      const ap = typeof (a as any).position === 'number' ? (a as any).position : 0;
      const bp = typeof (b as any).position === 'number' ? (b as any).position : 0;
      if (ap !== bp) return ap - bp;
      const ad = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
      return ad - bd;
    };

    const newPositions = new Map<string, number>();
    const payload: { _id: string; position: string }[] = [];

    for (const [key, subset] of grouped.entries()) {
      const parentNoteId = key === '__null__' ? null : key;
      const fullGroup = currentTasks
        .filter((t) => (t.parentNoteId ?? null) === parentNoteId)
        .slice()
        .sort(compareTasks);

      const subsetIds = new Set(subset.map((t) => t._id));
      const newGroup: Task[] = [];
      let subsetIndex = 0;

      for (const t of fullGroup) {
        if (subsetIds.has(t._id)) {
          newGroup.push(subset[subsetIndex] ?? t);
          subsetIndex += 1;
        } else {
          newGroup.push(t);
        }
      }

      while (subsetIndex < subset.length) {
        newGroup.push(subset[subsetIndex]);
        subsetIndex += 1;
      }

      for (let i = 0; i < newGroup.length; i += 1) {
        const id = newGroup[i]._id;
        newPositions.set(id, i);
        payload.push({ _id: id, position: encrypt(String(i)) as any });
      }
    }

    set((state) => ({
      tasks: state.tasks.map((t) => {
        const nextPos = newPositions.get(t._id);
        if (nextPos === undefined) return t;
        return { ...t, position: nextPos };
      }),
    }));
    try {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          await fetchWithAuth('/tasks/reorder', {
            method: 'PUT',
            body: JSON.stringify({ tasks: payload }),
          });
          for (const task of currentTasks) {
            const pos = newPositions.get(task._id);
            if (pos === undefined) continue;
            await Database.saveTaskLocal({ ...task, position: pos }, true);
          }
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          await Database.addToSyncQueue('REORDER', 'TASK', { tasks: payload });
          for (const task of currentTasks) {
            const pos = newPositions.get(task._id);
            if (pos === undefined) continue;
            await Database.saveTaskLocal({ ...task, position: pos }, false);
          }
        }
      } else {
        // Offline
        await Database.addToSyncQueue('REORDER', 'TASK', { tasks: payload });
        
        for (const task of currentTasks) {
          const pos = newPositions.get(task._id);
          if (pos === undefined) continue;
          await Database.saveTaskLocal({ ...task, position: pos }, false);
        }
      }
    } catch (error: any) {
      console.error('Reorder failed', error);
      // set({ error: error.message });
    }
  },

  syncOfflineChanges: async () => {
    if (get().securityLocked) return;
    if (get().isSyncingOffline) return;
    set({ isSyncingOffline: true });
    try {
      const queue = await Database.getSyncQueue();
      if (queue.length === 0) return;

      const tempIdMap = new Map<string, string>();

      for (const item of queue) {
        // Apply ID mapping from previous creations in this batch
        if (item.data.id && tempIdMap.has(item.data.id)) {
            item.data.id = tempIdMap.get(item.data.id);
        }
        if (item.data._id && tempIdMap.has(item.data._id)) {
            item.data._id = tempIdMap.get(item.data._id);
        }
        if (item.data.parentNoteId && tempIdMap.has(item.data.parentNoteId)) {
            item.data.parentNoteId = tempIdMap.get(item.data.parentNoteId);
        }
        if (item.data.parentId && tempIdMap.has(item.data.parentId)) {
            item.data.parentId = tempIdMap.get(item.data.parentId);
        }
        
        // Handle REORDER arrays
        if (item.action === 'REORDER') {
            if (item.data.notes && Array.isArray(item.data.notes)) {
                item.data.notes = item.data.notes.map((n: any) => ({
                    ...n,
                    _id: tempIdMap.get(n._id) || n._id,
                    parentId: (n.parentId && tempIdMap.get(n.parentId)) || n.parentId
                }));
            }
            if (item.data.tasks && Array.isArray(item.data.tasks)) {
                item.data.tasks = item.data.tasks.map((t: any) => ({
                    ...t,
                    _id: tempIdMap.get(t._id) || t._id
                }));
            }
        }

        try {
          if (item.entity === 'NOTE') {
            if (item.action === 'CREATE') {
              const { tempId, ...createData } = item.data;
              const created = await fetchWithAuth('/notes', {
                method: 'POST',
                body: JSON.stringify(createData),
              });
              if (tempId) {
                  const decryptedCreated = materializeNotesFromEncrypted([created as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
                  
                  // Update map
                  tempIdMap.set(tempId, decryptedCreated._id);

                  await Database.deleteNoteLocal(tempId);
                  await Database.saveNoteLocal(decryptedCreated, true);
                  set(state => {
                    const idx = state.notes.findIndex(n => n._id === tempId);
                    if (idx !== -1) {
                      const updated = [...state.notes];
                      updated[idx] = decryptedCreated;
                      return { notes: updated };
                    }
                    if (state.notes.find(n => n._id === decryptedCreated._id)) {
                      return state;
                    }
                    return { notes: [decryptedCreated, ...state.notes] };
                  });
              }
            } else if (item.action === 'UPDATE') {
              await fetchWithAuth(`/notes/${item.data.id}`, {
                method: 'PUT',
                body: JSON.stringify(item.data),
              });
            } else if (item.action === 'DELETE') {
              await fetchWithAuth(`/notes/${item.data.id}`, {
                method: 'DELETE',
              });
            } else if (item.action === 'REORDER') {
              await fetchWithAuth('/notes/reorder', {
                method: 'PUT',
                body: JSON.stringify(item.data),
              });
            }
          } else if (item.entity === 'TASK') {
            if (item.action === 'CREATE') {
              const { tempId, ...createData } = item.data;
              const created = await fetchWithAuth('/tasks', {
                method: 'POST',
                body: JSON.stringify(createData),
              });
              if (tempId) {
                  const decryptedCreated = processApiTask(created);
                  
                  // Update map
                  tempIdMap.set(tempId, decryptedCreated._id);

                  await Database.deleteTaskLocal(tempId);
                  await Database.saveTaskLocal(decryptedCreated, true);
                  set(state => {
                    // Check if the real task is already in state (e.g. via socket)
                    const alreadyExists = state.tasks.some(t => t._id === decryptedCreated._id);
                    const tempIdx = state.tasks.findIndex(t => t._id === tempId);
                    
                    if (alreadyExists) {
                        // If real task exists, just remove temp task if present
                        if (tempIdx !== -1) {
                            return { tasks: state.tasks.filter(t => t._id !== tempId) };
                        }
                        return state;
                    }
                    
                    // If temp task exists, replace it
                    if (tempIdx !== -1) {
                      const updated = [...state.tasks];
                      updated[tempIdx] = decryptedCreated;
                      return { tasks: updated };
                    }
                    
                    // Otherwise add new task
                    return { tasks: [...state.tasks, decryptedCreated] };
                  });
              }
            } else if (item.action === 'UPDATE') {
              await fetchWithAuth(`/tasks/${item.data.id}`, {
                method: 'PUT',
                body: JSON.stringify(item.data),
              });
            } else if (item.action === 'DELETE') {
              await fetchWithAuth(`/tasks/${item.data.id}`, {
                method: 'DELETE',
              });
            } else if (item.action === 'REORDER') {
              await fetchWithAuth('/tasks/reorder', {
                method: 'PUT',
                body: JSON.stringify(item.data),
              });
            }
          }
          await Database.removeFromSyncQueue(item.id);
        } catch (error) {
          const err: any = error;
          const status = typeof err?.status === 'number' ? err.status : undefined;
          if (status === 401) return; // auth problem — stop, keep the queue intact
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
            // Permanent client error — drop so it can't block the queue forever.
            await Database.removeFromSyncQueue(item.id);
          } else {
            // Transient (5xx / 429 / network): bump the retry counter and drop
            // only after MAX_SYNC_ATTEMPTS so a poison item can't retry forever.
            const attempts = await Database.incrementSyncAttempt(item.id);
            if (attempts >= MAX_SYNC_ATTEMPTS) {
              await Database.removeFromSyncQueue(item.id);
              console.warn('[sync] dropping item after max attempts', { id: item.id, action: item.action, entity: item.entity });
            }
          }
          console.error('Sync item failed', item, error);
        }
      }
      
      // Refresh data
      await get().fetchNotes();
      await get().fetchTasks();
    } catch (error) {
      console.error('Sync offline changes failed', error);
    } finally {
      set({ isSyncingOffline: false });
    }
  },

  verifyNoteLock: async (id, password) => {
    // Don't set global loading here to avoid flickering full screen, handle locally
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        throw new Error("Cannot unlock notes while offline");
      }

      const response = await fetchWithAuth(`/notes/${id}/verify-lock`, {
        method: 'POST',
        body: JSON.stringify({ password }),
        skipUnauthorized: true,
      });
      
      if (response?.success === false) {
        throw new Error('Incorrect password');
      }

      const decryptedContent = decrypt(response.content);
      const decryptedTitle = response.title ? decrypt(response.title) : 'Låst anteckning';

      const effectiveUnlockId = response.unlockedId || id;
      const unlockIds = response.unlockedId && response.unlockedId !== id
        ? [id, response.unlockedId]
        : [effectiveUnlockId];
      set(state => ({
        notes: state.notes.map(n => n._id === id ? { ...n, title: decryptedTitle, content: decryptedContent } : n),
        unlockedProtectedNoteIds: Array.from(new Set([...state.unlockedProtectedNoteIds, ...unlockIds])),
      }));
      await get().fetchNotes();

      return { title: decryptedTitle, content: decryptedContent, unlockedId: response.unlockedId || null };
    } catch (error: any) {
      const status = typeof error?.status === 'number' ? error.status : undefined;
      if (status === 401 || status === 403) {
        throw new Error('Incorrect password');
      }
      throw error;
    }
  },

  maskLockedNote: async (id) => {
    const note = get().notes.find(n => n._id === id);
    if (!note) return;
    const masked: Note = {
      ...note,
      title: 'Låst anteckning',
      content: '',
      locked: true,
    };
    set(state => ({
      notes: state.notes.map(n => n._id === id ? masked : n),
      unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((item) => item !== id),
    }));
    await Database.saveNoteLocal(masked, true);
  },
}));
