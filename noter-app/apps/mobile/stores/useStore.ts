import { create } from 'zustand';
import 'react-native-get-random-values';
import * as Crypto from 'expo-crypto';
import { Note, Task, CreateNoteDto, UpdateNoteDto, CreateTaskDto, UpdateTaskDto, encrypt, decrypt, decryptWithSource, hasEncryptionKey, isV3Ciphertext, normalizeId } from '@repo/shared';
import { fetchWithAuth, login as apiLogin, register as apiRegister, logout as apiLogout, setAuthToken, initApiUrl, setUnauthorizedHandler, setTokenUpdateHandler } from '../services/api';
import * as Database from '../services/database';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleTaskReminder, cancelTaskReminder, cancelAllTaskReminders, syncAllTaskReminders } from '../services/notifications';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '../services/ai/security';
import i18n from '../services/i18n';
import { initLocalEncryptionKey } from '../services/encryptionKey';
import { getReadableProtectedText } from '../utils/protectedNote';
import { recordStartupStage, recordSyncQueueDrain } from '../services/perfMetrics';

let wasOffline = false;
let initPromise: Promise<void> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let notesFetchPromise: Promise<void> | null = null;
const taskFetchPromises = new Map<string, Promise<void>>();
let lastRemoteCollectionsSyncAt = 0;
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const persistInBatches = async <T,>(items: T[], batchSize: number, persist: (item: T) => Promise<void>) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const chunk = items.slice(index, index + batchSize);
    await Promise.all(chunk.map((item) => persist(item)));
    if (index + batchSize < items.length) {
      await yieldToEventLoop();
    }
  }
};

interface AppState {
  notes: Note[];
  tasks: Task[];
  isLoading: boolean;
  isAuthenticating: boolean;
  isRefreshingNotes: boolean;
  isRefreshingTasks: boolean;
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
  syncOfflineChanges: (options?: { refreshAfterSync?: boolean }) => Promise<void>;

  // Security
  verifyNoteLock: (id: string, password: string) => Promise<{ title: string; content: string; unlockedId?: string | null }>;
  maskLockedNote: (id: string) => Promise<void>;
  
  // Auth
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
}

const processLocalNote = (note: Note): Note => ({
  ...note,
});

const decryptStringOrFallback = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  if (isV3Ciphertext(value)) return fallback;
  const result = decryptWithSource(value);
  if (result.source === 'failed') return fallback;
  if (result.source === 'plaintext') return value;
  return result.value;
};

const decryptOptionalString = (value: unknown): string | undefined => {
  const decrypted = decryptStringOrFallback(value, '');
  const trimmed = decrypted.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const decryptIdOrNull = (value: unknown): string | null => {
  const decrypted = decryptStringOrFallback(value, '');
  const normalized = normalizeId(decrypted);
  return normalized || null;
};

const decryptOrFallback = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  if (isV3Ciphertext(value)) return fallback;
  const result = decryptWithSource(value);
  if (result.source === 'failed') return fallback;
  if (result.source === 'plaintext') return value;
  return result.value;
};

const toStoredString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/\s+/g, '_');
  normalized = normalized.replace(/-/g, '_');
  if (normalized === 'projectfolder' || normalized === 'project_folder') return 'project';
  if (normalized.includes('project') || normalized.includes('folder')) return 'project';
  if (normalized === 'folder') return 'project';
  if (normalized === 'dir' || normalized === 'directory') return 'project';
  if (normalized === 'tasklist' || normalized === 'task_list') return 'task_list';
  if (normalized.includes('task') && normalized.includes('list')) return 'task_list';
  return normalized || 'note';
};

const taskFetchKey = (parentNoteId?: string) => parentNoteId || '__all__';

const markRemoteCollectionsSynced = () => {
  lastRemoteCollectionsSyncAt = Date.now();
};

const hasRecentRemoteCollectionsSync = () => Date.now() - lastRemoteCollectionsSyncAt < 3000;

const parseNoteDateValue = (value: unknown): string => {
  if (typeof value !== 'string') return new Date().toISOString();
  try {
    return decrypt(value);
  } catch {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : value;
  }
};

const normalizeEncryptedNote = (note: Note): any => {
  const rawTitle = (note as any).__rawEncryptedTitle ?? note.title;
  const rawContent = (note as any).__rawEncryptedContent ?? note.content;
  const rawTags = (note as any).__rawEncryptedTags ?? (note as any).tags;
  const rawIcon = (note as any).__rawEncryptedIcon ?? (note as any).icon;
  const locked = parseNoteLocked(note.locked);
  return {
  ...note,
  title: toStoredString(rawTitle),
  content: toStoredString(rawContent),
  tags: Array.isArray(rawTags) ? rawTags : (typeof rawTags === 'string' ? [rawTags] : []),
  icon: typeof rawIcon === 'string' ? rawIcon : undefined,
  type: normalizeNoteType(typeof (note as any).type === 'string' ? decryptStringOrFallback((note as any).type, '') : (note as any).type),
  parentId: decryptIdOrNull(note.parentId),
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
  __rawEncryptedTitle: toStoredString(rawTitle),
  __rawEncryptedContent: toStoredString(rawContent),
  __rawEncryptedTags: Array.isArray(rawTags) ? rawTags : rawTags,
  __rawEncryptedIcon: typeof rawIcon === 'string' ? rawIcon : undefined,
  };
};

const materializeNotesFromEncrypted = (notes: Note[], unlockedIds: Set<string>): Note[] => {
  const normalized = notes.map(normalizeEncryptedNote);
  const noteMap = buildSecurityNoteMap(normalized as any);
  return normalized.map((note: any) => {
    const blocking = findBlockingLockedAncestor(note, noteMap as any, unlockedIds);
    if (blocking) {
      const isDirectlyLockedProject = blocking._id === note._id && note.type === 'project';
      let projectIcon: string | undefined = undefined;
      if (isDirectlyLockedProject) {
        projectIcon = decryptOptionalString(note.__rawEncryptedIcon);
      }
      return {
        ...note,
        title: isDirectlyLockedProject ? i18n.t('projects.lockedProject') : i18n.t('note.locked'),
        content: '',
        tags: [],
        icon: isDirectlyLockedProject ? projectIcon : undefined,
        iconColor: undefined,
        locked: true,
      };
    }
    return {
      ...note,
      title: decryptOrFallback(note.__rawEncryptedTitle || note.title, ''),
      content: decryptOrFallback(note.__rawEncryptedContent || note.content, ''),
      tags: Array.isArray(note.__rawEncryptedTags)
        ? note.__rawEncryptedTags
            .map((t: any) => decryptStringOrFallback(t, ''))
            .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
        : (() => {
            if (typeof note.__rawEncryptedTags !== 'string') return [];
            try {
              const decoded = decrypt(note.__rawEncryptedTags);
              const parsed = JSON.parse(decoded);
              return Array.isArray(parsed)
                ? parsed
                    .map((t: any) => decryptStringOrFallback(t, ''))
                    .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
                : [];
            } catch {
              return [];
            }
          })(),
      icon: decryptOptionalString(note.__rawEncryptedIcon),
      locked: parseNoteLocked(note.locked),
    };
  });
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
  title: decryptOrFallback(task.title, ''),
  description: task.description ? decryptOrFallback(task.description, '') : '',
  completed: parseTaskCompleted(task.completed),
  priority: parseTaskPriority(task.priority),
  dueDate: task.dueDate ? (typeof task.dueDate === 'string' ? decrypt(task.dueDate) : task.dueDate) : null,
  recurrenceType: task.recurrenceType ? (() => { try { return decrypt(task.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
  recurrenceDays: task.recurrenceDays ? (() => { try { return JSON.parse(decrypt(task.recurrenceDays)) } catch { return [] } })() : [],
  reminderEnabled: task.reminderEnabled ? (() => { try { return decrypt(task.reminderEnabled) === 'true' } catch { return false } })() : false,
  reminderOffsetMinutes: task.reminderOffsetMinutes ? (() => { try { return parseReminderOffsets(decrypt(task.reminderOffsetMinutes)); } catch { return []; } })() : [],
  createdAt: decrypt(task.createdAt),
  updatedAt: decrypt(task.updatedAt),
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

const mergeTasksForScope = (existingTasks: Task[], scopedTasks: Task[], parentNoteId?: string) => {
  if (!parentNoteId) {
    return scopedTasks;
  }
  const remaining = existingTasks.filter((task) => task.parentNoteId !== parentNoteId);
  return [...remaining, ...scopedTasks];
};

const shouldFallbackToOffline = (error: unknown) => {
  const err = error as any;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const code = String(err?.code ?? '').toLowerCase();
  const message = String(err?.message ?? '').toLowerCase();

  const isConnectivity =
    code === 'request_timeout' ||
    message.includes('could not connect to server') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message === 'aborted' ||
    message.includes('abort') ||
    message.includes('timed out') ||
    message.includes('timeout');

  const isServer = typeof status === 'number' && status >= 500;
  const isRateLimit = status === 429;

  return isConnectivity || isServer || isRateLimit;
};

const shouldSuppressCollectionError = (error: unknown, localCount: number) => (
  localCount > 0 && shouldFallbackToOffline(error)
);

const syncTaskReminder = async (task: Task, notificationsEnabled: boolean) => {
  if (!notificationsEnabled || !task.reminderEnabled) {
    await cancelTaskReminder(task._id);
    return;
  }
  await scheduleTaskReminder(task);
};

const syncTaskReminderDeferred = (task: Task, notificationsEnabled: boolean, previousTaskId?: string) => {
  void (async () => {
    try {
      if (previousTaskId && previousTaskId !== task._id) {
        await cancelTaskReminder(previousTaskId);
      }
      await syncTaskReminder(task, notificationsEnabled);
    } catch (error) {
      console.warn('Task reminder sync failed', error);
    }
  })();
};

const cancelTaskReminderDeferred = (taskId: string) => {
  void cancelTaskReminder(taskId).catch((error) => {
    console.warn('Task reminder cancel failed', error);
  });
};

export const useStore = create<AppState>((set, get) => ({
  notes: [],
  tasks: [],
  isLoading: false,
  isAuthenticating: false,
  isRefreshingNotes: false,
  isRefreshingTasks: false,
  error: null,
  viewMode: 'list',
  isOffline: false,
  isSyncingOffline: false,
  activeProjectId: null,
  token: null,
  isInitialized: false,
  notificationsEnabled: false,
  securityLocked: false,
  unlockedProtectedNoteIds: [],

  setActiveProject: (id) => {
    const normalized = id ? normalizeId(id) : null;
    set((state) => {
      const previous = state.activeProjectId ? normalizeId(state.activeProjectId) : null;
      if (previous && previous !== normalized) {
        const nextUnlocked = state.unlockedProtectedNoteIds.filter((item) => normalizeId(item) !== previous);
        return {
          activeProjectId: normalized,
          unlockedProtectedNoteIds: nextUnlocked,
          notes: materializeNotesFromEncrypted(state.notes as any, new Set(nextUnlocked)),
        };
      }
      return { activeProjectId: normalized };
    });
    AsyncStorage.setItem('activeProjectId', normalized || '').catch(() => {});
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
  setViewMode: (mode) => {
    set({ viewMode: mode });
    AsyncStorage.setItem('viewMode', mode).catch(() => {});
  },
  setSecurityLocked: async (locked) => {
    if (get().securityLocked === locked) return;
    if (locked) {
      disconnectSocket();
      set({
        securityLocked: true,
        notes: [],
        tasks: [],
        activeProjectId: null,
        isLoading: false,
        isAuthenticating: false,
        isRefreshingNotes: false,
        isRefreshingTasks: false,
        error: null,
        unlockedProtectedNoteIds: [],
      });
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
    await syncAllTaskReminders(get().tasks, true, { cancelMissing: true });
  },

  init: async () => {
    if (get().isInitialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let storedToken: string | null = null;
      let databaseReady = false;
      let encryptionReady = true;
        const measureStartupStage = async <T,>(name: string, action: () => Promise<T>) => {
          const startedAt = Date.now();
          try {
            return await action();
          } finally {
            recordStartupStage(name, Date.now() - startedAt);
          }
        };
      try {
          const localKey = await measureStartupStage('localEncryptionKey', () => initLocalEncryptionKey());
          encryptionReady = Boolean(localKey) && hasEncryptionKey();
          await measureStartupStage('apiUrl', () => initApiUrl());
          await measureStartupStage('databaseInit', () => Database.initDatabase());
          await measureStartupStage('databaseMigration', () => Database.migrateLocalEncryptedData());
        databaseReady = true;

          const [
            nextStoredToken,
            storedNotifications,
            storedActiveProjectId,
            storedViewMode,
          ] = await Promise.all([
            measureStartupStage('secureTokenRead', () => SecureStore.getItemAsync('token')),
            measureStartupStage('notificationsPreferenceRead', () => AsyncStorage.getItem('notificationsEnabled')),
            measureStartupStage('activeProjectRead', () => AsyncStorage.getItem('activeProjectId')),
            measureStartupStage('viewModeRead', () => AsyncStorage.getItem('viewMode')),
          ]);
          storedToken = nextStoredToken;
        if (storedNotifications !== null) {
          set({ notificationsEnabled: storedNotifications === 'true' });
        }
        if (storedActiveProjectId && storedActiveProjectId !== 'null') {
          set({ activeProjectId: normalizeId(storedActiveProjectId) });
        }
        if (storedViewMode) {
          set({ viewMode: storedViewMode as any });
        }
        if (storedToken) {
          setAuthToken(storedToken);
          set({ token: storedToken });
        }
        if (storedToken && !encryptionReady) {
          await Promise.resolve(apiLogout()).catch(() => {});
          setAuthToken(null);
          storedToken = null;
          set({
            token: null,
            notes: [],
            tasks: [],
            activeProjectId: null,
            unlockedProtectedNoteIds: [],
            error: i18n.t('common.reloginToUnlock'),
            isLoading: false,
            isAuthenticating: false,
            isRefreshingNotes: false,
            isRefreshingTasks: false,
          });
        }

        setUnauthorizedHandler(async () => {
          await get().logout();
        });
        setTokenUpdateHandler(async (token) => {
          get().setToken(token);
          const socket = getSocket();
          if (socket) {
            socket.auth = { token: token || '' };
            if (socket.connected) socket.disconnect();
          }
        });

        if (!get().securityLocked && encryptionReady) {
          const [localNotes, localTasks] = await Promise.all([
            measureStartupStage('loadLocalNotes', () => Database.getNotesLocal()),
            measureStartupStage('loadLocalTasks', () => Database.getTasksLocal()),
          ]);
          const processedLocalTasks = localTasks.map(processLocalTask);
          const unlocked = new Set(get().unlockedProtectedNoteIds || []);
          set({
            notes: materializeNotesFromEncrypted(localNotes.map(processLocalNote), unlocked),
            tasks: processedLocalTasks
          });
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(processedLocalTasks, true, { cancelMissing: true });
          }
        }
      } catch (error: any) {
        console.error('[Store] Init failed:', error);
        set({
          error: error?.message || 'Appstart misslyckades',
          notes: [],
          tasks: [],
          isLoading: false,
          isAuthenticating: false,
          isRefreshingNotes: false,
          isRefreshingTasks: false,
        });
      }

      if (!netInfoUnsubscribe) {
        netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const isOffline = !state.isConnected;
          set({ isOffline });
          if (!databaseReady) return;
          if (!isOffline) {
            const refreshAfterSync = wasOffline;
            wasOffline = false;
            void get().syncOfflineChanges({ refreshAfterSync });
          } else {
            wasOffline = true;
          }
        });
      }

      if (databaseReady && storedToken && !get().securityLocked) {
        const socketStartedAt = Date.now();
        get().connectSocket();
        recordStartupStage('socketConnect', Date.now() - socketStartedAt);
        await Promise.all([
          measureStartupStage('remoteNotesFetch', () => get().fetchNotes()),
          measureStartupStage('remoteTasksFetch', () => get().fetchTasks()),
        ]);
      }

      set({ isInitialized: true });
    })();
    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  },

  // Fallback sync method when WebSocket fails
  syncViaHttp: async () => {
    if (get().securityLocked) return;
    if (hasRecentRemoteCollectionsSync()) return;
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
    if (!token) {
      disconnectSocket();
      return;
    }
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
      syncTaskReminderDeferred(parsed, get().notificationsEnabled);
    });

    socket.on('task:updated', (task: Task) => {
      const parsed = processApiTask(task);
      set(state => {
        Database.saveTaskLocal(parsed, true);
        return {
          tasks: state.tasks.map(t => t._id === parsed._id ? parsed : t)
        };
      });
      syncTaskReminderDeferred(parsed, get().notificationsEnabled);
    });

    socket.on('task:deleted', (id: string) => {
      set(state => {
        Database.deleteTaskLocal(id);
        return {
          tasks: state.tasks.filter(t => t._id !== id)
        };
      });
      cancelTaskReminderDeferred(id);
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

    socket.on('connect', () => {
      void get().syncViaHttp();
    });
  },

  login: async (username, password) => {
    try {
      set({ isLoading: true, isAuthenticating: true, error: null });
      const response = await apiLogin(username, password);
      if (!response?.token) {
        throw new Error('Login failed');
      }
      setAuthToken(response.token);
      await SecureStore.setItemAsync('token', response.token);
      get().setToken(response.token);
      if (get().securityLocked) {
        await get().setSecurityLocked(false);
      }
      if (get().isInitialized) {
        await get().fetchNotes();
        await get().fetchTasks();
        get().connectSocket();
      } else {
        await get().init();
      }
    } catch (error: any) {
      set({ error: error.message || 'Login failed' });
      throw error;
    } finally {
      set({ isLoading: false, isAuthenticating: false });
    }
  },

  register: async (username: string, password: string) => {
    try {
      set({ isLoading: true, isAuthenticating: true, error: null });
      await apiRegister(username, password);
      // Automatically login after register
      await get().login(username, password);
    } catch (error: any) {
      set({ error: error.message || 'Registration failed' });
      throw error;
    } finally {
      set({ isLoading: false, isAuthenticating: false });
    }
  },

  logout: async () => {
    try {
      await apiLogout();
    } catch {}
    setAuthToken(null);
    disconnectSocket();
    set({ token: null, notes: [], tasks: [], activeProjectId: null, error: null, unlockedProtectedNoteIds: [] });
  },

  fetchNotes: async () => {
    if (get().securityLocked) {
      set({ isRefreshingNotes: false });
      return;
    }
    if (notesFetchPromise) return notesFetchPromise;
    notesFetchPromise = (async () => {
      set({ isRefreshingNotes: true, error: null });
      try {
        const netState = await NetInfo.fetch();
        
        if (netState.isConnected) {
          const notes = await fetchWithAuth('/notes', { timeoutMs: 45000 });
          const safeNotes = Array.isArray(notes) ? notes : [];
          const securedNotes = materializeNotesFromEncrypted(safeNotes as any, new Set(get().unlockedProtectedNoteIds));
          const persistableNotes = (safeNotes as any[]).map((note) => normalizeEncryptedNote(note as Note));
          const localNoteIndex = typeof Database.getLocalNoteSyncIndex === 'function'
            ? await Database.getLocalNoteSyncIndex()
            : new Map<string, string>();
          const remoteNoteUpdatedAtById = new Map(securedNotes.map((note) => [note._id, String(note.updatedAt || '')]));

          const notesToPersist = persistableNotes.filter((note) => {
            const remoteUpdatedAt = remoteNoteUpdatedAtById.get(note._id) || '';
            return localNoteIndex.get(note._id) !== remoteUpdatedAt;
          });
          await persistInBatches(notesToPersist, 25, (note) => Database.saveNoteLocal(note, true));
          set({ notes: securedNotes, isRefreshingNotes: false });
        } else {
          const localNotes = await Database.getNotesLocal();
          const securedNotes = materializeNotesFromEncrypted(localNotes.map(processLocalNote) as any, new Set(get().unlockedProtectedNoteIds));
          set({ notes: securedNotes, isRefreshingNotes: false });
        }
      } catch (error: any) {
        console.error('[Store] Fetch notes error:', error);
        const localNotes = await Database.getNotesLocal();
        const securedNotes = materializeNotesFromEncrypted(localNotes.map(processLocalNote) as any, new Set(get().unlockedProtectedNoteIds));
        set({
          notes: securedNotes,
          isRefreshingNotes: false,
          error: shouldSuppressCollectionError(error, localNotes.length) ? null : error.message,
        });
      }
    })();
    try {
      await notesFetchPromise;
    } finally {
      notesFetchPromise = null;
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
        tags: data.tags ? data.tags.map(t => encrypt(t)) : [],
        icon: data.icon ? encrypt(data.icon) : undefined,
        iconColor: data.iconColor ? encrypt(data.iconColor) : undefined,
        type: encrypt(data.type || 'note'),
        locked: encrypt(String(data.locked || false)),
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
    const { unlockPassword, ...updateData } = (data as any) ?? {};
    
    // 1. Get current note
    const state = get();
    const currentNote = state.notes.find(n => n._id === id);
    if (!currentNote) throw new Error('Note not found');

    const isSensitivePasswordChange = typeof unlockPassword === 'string'
      || (typeof updateData.password === 'string' && updateData.password.length > 0);
    if (isSensitivePasswordChange) {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        set({ isLoading: false });
        throw new Error('Cannot change note password while offline');
      }
    }

    if (isSensitivePasswordChange) {
      try {
        const encryptedData: any = { ...updateData };
        if (updateData.title !== undefined) encryptedData.title = encrypt(updateData.title);
        if (updateData.content !== undefined) encryptedData.content = encrypt(updateData.content);
        if (updateData.tags !== undefined) encryptedData.tags = updateData.tags.map((t: string) => encrypt(t));
        if (updateData.icon !== undefined) encryptedData.icon = updateData.icon ? encrypt(updateData.icon) : '';
        if (updateData.type !== undefined) encryptedData.type = encrypt(updateData.type);
        if (updateData.locked !== undefined) encryptedData.locked = encrypt(String(updateData.locked));
        if (updateData.order !== undefined) encryptedData.order = encrypt(String(updateData.order));
        if (updateData.password !== undefined) encryptedData.password = updateData.password;
        encryptedData.updatedAt = encrypt(new Date().toISOString());
        if (typeof unlockPassword === 'string') {
          encryptedData.unlockPassword = unlockPassword;
        }

        const updated = await fetchWithAuth(`/notes/${id}`, {
          method: 'PUT',
          body: JSON.stringify(encryptedData),
        });
        const realNote = materializeNotesFromEncrypted([updated as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;

        set((state) => {
          const nextUnlocked = state.unlockedProtectedNoteIds.filter((item) => item !== id);
          return {
            notes: materializeNotesFromEncrypted(
              state.notes.map((n) => n._id === id ? realNote : n) as any,
              new Set(nextUnlocked),
            ),
            unlockedProtectedNoteIds: nextUnlocked,
            isLoading: false,
          };
        });

        await Database.saveNoteLocal(realNote, true);
        return realNote;
      } catch (error: any) {
        set({ error: error?.message || String(error), isLoading: false });
        throw error;
      }
    }

    const optimisticNote: Note = {
        ...currentNote,
        ...(updateData.title !== undefined ? { title: updateData.title } : {}),
        ...(updateData.content !== undefined ? { content: updateData.content } : {}),
        ...(updateData.tags !== undefined ? { tags: updateData.tags } : {}),
        ...(updateData.parentId !== undefined ? { parentId: updateData.parentId } : {}),
        ...(updateData.locked !== undefined ? { locked: typeof updateData.locked === 'string' ? updateData.locked === 'true' : updateData.locked } : {}),
        ...(updateData.icon !== undefined ? { icon: updateData.icon } : {}),
        ...(updateData.order !== undefined ? { order: updateData.order } : {}),
        ...(updateData.type !== undefined ? { type: updateData.type } : {}),
        updatedAt: new Date().toISOString()
    };
    if (updateData.locked === true) {
        const existingRawTitle = (currentNote as any).__rawEncryptedTitle;
        const existingRawContent = (currentNote as any).__rawEncryptedContent;
        const existingRawTags = (currentNote as any).__rawEncryptedTags;
        const existingRawIcon = (currentNote as any).__rawEncryptedIcon;
        (optimisticNote as any).__rawEncryptedTitle = existingRawTitle || encrypt(currentNote.title || '');
        (optimisticNote as any).__rawEncryptedContent = existingRawContent || encrypt(currentNote.content || '');
        (optimisticNote as any).__rawEncryptedTags = existingRawTags || encrypt(JSON.stringify(currentNote.tags || []));
        (optimisticNote as any).__rawEncryptedIcon = existingRawIcon || (currentNote.icon ? encrypt(currentNote.icon) : undefined);
        optimisticNote.title = i18n.t('note.locked');
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
      const encryptedData: any = { ...updateData };
      if (updateData.title !== undefined) encryptedData.title = encrypt(updateData.title);
      if (updateData.content !== undefined) encryptedData.content = encrypt(updateData.content);
      if (updateData.tags !== undefined) encryptedData.tags = updateData.tags.map((t: string) => encrypt(t));
      if (updateData.icon !== undefined) encryptedData.icon = updateData.icon ? encrypt(updateData.icon) : '';
      if (updateData.type !== undefined) encryptedData.type = encrypt(updateData.type);
      if (updateData.locked !== undefined) encryptedData.locked = encrypt(String(updateData.locked));
      if (updateData.order !== undefined) encryptedData.order = encrypt(String(updateData.order));
      if (updateData.password !== undefined) encryptedData.password = updateData.password;
      // Always update updatedAt
      encryptedData.updatedAt = encrypt(new Date().toISOString());

      // 5. Try Sync
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          if (typeof unlockPassword === 'string') {
            encryptedData.unlockPassword = unlockPassword;
          }
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
          const isSettingPassword = typeof updateData.password === 'string' && updateData.password.length > 0;
          if (typeof unlockPassword === 'string' || isSettingPassword) throw error;
          if (!shouldFallbackToOffline(error)) throw error;
          const mergedIntoCreate = await Database.mergeIntoQueuedCreate('NOTE', id, encryptedData);
          if (!mergedIntoCreate) {
            await Database.addToSyncQueue('UPDATE', 'NOTE', { id, ...encryptedData });
          }
          return optimisticNote;
        }
      } else {
         if (typeof unlockPassword === 'string') {
           throw new Error('Cannot remove lock while offline');
         }
         const mergedIntoCreate = await Database.mergeIntoQueuedCreate('NOTE', id, encryptedData);
         if (!mergedIntoCreate) {
           await Database.addToSyncQueue('UPDATE', 'NOTE', { id, ...encryptedData });
         }
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
          const removedQueuedCreate = await Database.removeQueuedCreate('NOTE', id);
          if (!removedQueuedCreate) {
            await Database.addToSyncQueue('DELETE', 'NOTE', { id });
          }
        }
      } else {
        const removedQueuedCreate = await Database.removeQueuedCreate('NOTE', id);
        if (!removedQueuedCreate) {
          await Database.addToSyncQueue('DELETE', 'NOTE', { id });
        }
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
      set({ isRefreshingTasks: false });
      return;
    }
    const fetchKey = taskFetchKey(parentNoteId);
    const inFlight = taskFetchPromises.get(fetchKey);
    if (inFlight) return inFlight;
    const fetchPromise = (async () => {
      set({ isRefreshingTasks: true, error: null });
      try {
        const netState = await NetInfo.fetch();
        if (netState.isConnected) {
          const url = parentNoteId ? `/tasks?parentNoteId=${encodeURIComponent(parentNoteId)}` : '/tasks';
          const tasks = await fetchWithAuth(url, { timeoutMs: 30000 });
          const decryptedTasks = tasks.map(processApiTask);
          const localTaskIndex = typeof Database.getLocalTaskSyncIndex === 'function'
            ? await Database.getLocalTaskSyncIndex()
            : new Map<string, string>();
          const tasksToPersist = (decryptedTasks as Task[]).filter((task: Task) => localTaskIndex.get(task._id) !== String(task.updatedAt || ''));
          await persistInBatches(tasksToPersist, 25, (task: Task) => Database.saveTaskLocal(task, true));
          
          const state = get();
          const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
          const localOnlyTasks = state.tasks.filter(t => t._id.startsWith('local_task_') && !serverClientIds.has(t.clientId));

          const mergedTasks = mergeTasksForScope(
            state.tasks,
            [...decryptedTasks, ...localOnlyTasks],
            parentNoteId
          );
          set({ tasks: mergedTasks, isRefreshingTasks: false });
          if (!parentNoteId) {
            markRemoteCollectionsSynced();
          }
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(mergedTasks, true, { cancelMissing: !parentNoteId });
          }
        } else {
          const localTasks = await Database.getTasksLocal();
          const filtered = parentNoteId ? localTasks.filter(t => t.parentNoteId === parentNoteId) : localTasks;
          const mapped = filtered.map(processLocalTask);
          const mergedTasks = mergeTasksForScope(get().tasks, mapped, parentNoteId);
          set({ tasks: mergedTasks, isRefreshingTasks: false });
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(mergedTasks, true, { cancelMissing: !parentNoteId });
          }
        }
      } catch (error: any) {
        const localTasks = await Database.getTasksLocal();
        const filtered = parentNoteId ? localTasks.filter(t => t.parentNoteId === parentNoteId) : localTasks;
        const mapped = filtered.map(processLocalTask);
        const mergedTasks = mergeTasksForScope(get().tasks, mapped, parentNoteId);
        set({
          tasks: mergedTasks,
          isRefreshingTasks: false,
          error: shouldSuppressCollectionError(error, filtered.length) ? null : error.message,
        });
        if (get().notificationsEnabled) {
          await syncAllTaskReminders(mergedTasks, true, { cancelMissing: !parentNoteId });
        }
      }
    })();
    taskFetchPromises.set(fetchKey, fetchPromise);
    try {
      await fetchPromise;
    } finally {
      if (taskFetchPromises.get(fetchKey) === fetchPromise) {
        taskFetchPromises.delete(fetchKey);
      }
    }
  },

  backgroundRefresh: async () => {
    if (get().securityLocked) return;
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) return;

      const [notes, tasks] = await Promise.all([
        fetchWithAuth('/notes', { timeoutMs: 45000 }),
        fetchWithAuth('/tasks', { timeoutMs: 30000 }),
      ]);
      const safeNotes = Array.isArray(notes) ? notes : [];
      const decryptedNotes = materializeNotesFromEncrypted(safeNotes as any, new Set(get().unlockedProtectedNoteIds));
      const persistableNotes = (safeNotes as any[]).map((note) => normalizeEncryptedNote(note as Note));
      const localNoteIndex = typeof Database.getLocalNoteSyncIndex === 'function'
        ? await Database.getLocalNoteSyncIndex()
        : new Map<string, string>();
      const notesToPersist = persistableNotes.filter((note) => localNoteIndex.get(note._id) !== String(note.updatedAt || ''));
      await persistInBatches(notesToPersist, 25, (note) => Database.saveNoteLocal(note, true));
      set({ notes: decryptedNotes });

      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const decryptedTasks = safeTasks.map(processApiTask);
      const localTaskIndex = typeof Database.getLocalTaskSyncIndex === 'function'
        ? await Database.getLocalTaskSyncIndex()
        : new Map<string, string>();
      const tasksToPersist = (decryptedTasks as Task[]).filter((task: Task) => localTaskIndex.get(task._id) !== String(task.updatedAt || ''));
      await persistInBatches(tasksToPersist, 25, (task: Task) => Database.saveTaskLocal(task, true));
      const state = get();
      const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
      const localOnlyTasks = state.tasks.filter(t => t._id.startsWith('local_task_') && !serverClientIds.has((t as any).clientId));
      const mergedTasks = [...decryptedTasks, ...localOnlyTasks];
      set({ tasks: mergedTasks });
      if (get().notificationsEnabled) {
        await syncAllTaskReminders(mergedTasks, true, { cancelMissing: true });
      }
    } catch (error) {
      console.error('Background refresh failed', error);
    }
  },

  createTask: async (data) => {
    set({ error: null });
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
    }));

    try {
      await Database.saveTaskLocal(optimisticTask, false);
      syncTaskReminderDeferred(optimisticTask, get().notificationsEnabled);

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
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        position: data.position !== undefined ? encrypt(String(data.position)) : encrypt('0'),
        clientId,
      };

      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const created = await fetchWithAuth('/tasks', {
            method: 'POST',
            body: JSON.stringify(encryptedData),
          });
          const realTask = processApiTask(created);

          set((state) => {
            const exists = state.tasks.some(t => t._id === realTask._id);
            if (exists) {
                return {
                    tasks: state.tasks.filter(t => t._id !== tempId)
                };
            }
            return {
              tasks: state.tasks.map(t => t._id === tempId ? realTask : t)
            };
          });

          await Database.deleteTaskLocal(tempId);
          await Database.saveTaskLocal(realTask, true);
          syncTaskReminderDeferred(realTask, get().notificationsEnabled, tempId);

          return realTask;
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error; 
          
          await Database.addToSyncQueue('CREATE', 'TASK', { ...encryptedData, tempId });
          return optimisticTask;
        }
      } else {
        await Database.addToSyncQueue('CREATE', 'TASK', { ...encryptedData, tempId });
        return optimisticTask;
      }
    } catch (error: any) {
      set((state) => ({
        tasks: state.tasks.filter(t => t._id !== tempId),
        error: error.message,
      }));
      throw error;
    }
  },

  updateTask: async (id, data) => {
    set({ error: null });

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
        void get().createTask({
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
        }).catch((error) => {
          console.error('Failed to create recurring task', error);
        });
      }
    }

    set((state) => ({
      tasks: state.tasks.map((t) => (t._id === id ? optimisticTask : t)),
    }));

    try {
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
      encryptedData.updatedAt = encrypt(new Date().toISOString());
      if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));

      await Database.saveTaskLocal(optimisticTask, false);
      syncTaskReminderDeferred(optimisticTask, get().notificationsEnabled);

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
          syncTaskReminderDeferred(realTask, get().notificationsEnabled);

          return realTask;
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          const mergedIntoCreate = await Database.mergeIntoQueuedCreate('TASK', id, encryptedData);
          if (!mergedIntoCreate) {
            await Database.addToSyncQueue('UPDATE', 'TASK', { id, ...encryptedData });
          }
          return optimisticTask;
        }
      } else {
        const mergedIntoCreate = await Database.mergeIntoQueuedCreate('TASK', id, encryptedData);
        if (!mergedIntoCreate) {
          await Database.addToSyncQueue('UPDATE', 'TASK', { id, ...encryptedData });
        }
        return optimisticTask;
      }
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  deleteTask: async (id) => {
    set({ error: null });
    try {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          await fetchWithAuth(`/tasks/${id}`, {
            method: 'DELETE',
          });
        } catch (error) {
          if (!shouldFallbackToOffline(error)) throw error;
          const removedQueuedCreate = await Database.removeQueuedCreate('TASK', id);
          if (!removedQueuedCreate) {
            await Database.addToSyncQueue('DELETE', 'TASK', { id });
          }
        }
      } else {
        const removedQueuedCreate = await Database.removeQueuedCreate('TASK', id);
        if (!removedQueuedCreate) {
          await Database.addToSyncQueue('DELETE', 'TASK', { id });
        }
      }
      
      await Database.deleteTaskLocal(id);
      cancelTaskReminderDeferred(id);

      set((state) => ({
        tasks: state.tasks.filter((t) => t._id !== id),
      }));
    } catch (error: any) {
      set({ error: error.message });
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

  syncOfflineChanges: async (options) => {
    if (get().securityLocked) return;
    if (get().isSyncingOffline) return;
    set({ isSyncingOffline: true });
    const syncStartedAt = Date.now();
    let initialQueueSize = 0;
    let failedItems = 0;
    let oldestItemAgeMs: number | null = null;
    try {
      const queue = await Database.getSyncQueue();
      initialQueueSize = queue.length;
      oldestItemAgeMs = queue.length
        ? Math.max(0, ...queue.map((item) => Date.now() - new Date(item.timestamp).getTime()))
        : null;
      if (queue.length === 0) {
        if (options?.refreshAfterSync) {
          await get().fetchNotes();
          await get().fetchTasks();
        }
        return;
      }

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
          failedItems += 1;
          const err: any = error;
          const status = typeof err?.status === 'number' ? err.status : undefined;
          if (status === 401) return;
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
            await Database.removeFromSyncQueue(item.id);
          }
          console.error('Sync item failed', item, error);
        }
      }
      
      await get().fetchNotes();
      await get().fetchTasks();
    } catch (error) {
      console.error('Sync offline changes failed', error);
    } finally {
      if (initialQueueSize > 0) {
        recordSyncQueueDrain({
          batchSize: initialQueueSize,
          failedItems,
          durationMs: Date.now() - syncStartedAt,
          oldestItemAgeMs,
        });
      }
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

      const decryptedContent = getReadableProtectedText(response.content, '', '');
      const decryptedTitle = response.title
        ? getReadableProtectedText(response.title, i18n.t('note.locked'), i18n.t('note.locked'))
        : i18n.t('note.locked');

      const effectiveUnlockId = response.unlockedId || id;
      const unlockIds = response.unlockedId && response.unlockedId !== id
        ? [id, response.unlockedId]
        : [effectiveUnlockId];
      set(state => ({
        notes: state.notes.map(n => n._id === id ? {
          ...n,
          title: decryptedTitle,
          content: decryptedContent,
          __rawEncryptedTitle: typeof response.title === 'string' ? response.title : (n as any).__rawEncryptedTitle,
          __rawEncryptedContent: typeof response.content === 'string' ? response.content : (n as any).__rawEncryptedContent,
        } : n),
        unlockedProtectedNoteIds: Array.from(new Set([...state.unlockedProtectedNoteIds, ...unlockIds])),
      }));

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
      title: i18n.t('note.locked'),
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
