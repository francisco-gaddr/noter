import { create } from 'zustand';
import { Note, Task, UpdateTaskDto, User, decrypt, encrypt, normalizeNoteType } from '@repo/shared';
import { api, getApiBaseUrl, getUUID, setApiBaseUrl, setApiToken } from '../services/api';
import { socket, connectSocket, disconnectSocket, setSocketToken } from '../services/socket';
import { db } from '../services/db';
import deepmerge from 'deepmerge';
import { uniqBy } from 'lodash';
import CryptoJS from 'crypto-js';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '../services/ai/security';

let networkListenersReady = false;

const shouldLogElectronDataDebug = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'file:') return false;
  try {
    return localStorage.getItem('debugElectronDataFlow') === '1';
  } catch {
    return false;
  }
};

const logElectronDataDebug = (stage: string, payload: Record<string, unknown>) => {
  if (!shouldLogElectronDataDebug()) return;
  console.info('[ElectronDataDebug]', stage, payload);
};

const setElectronToken = (value: string | null) => {
  if (typeof window === 'undefined') return;
  const mlc = (window as any).mlc;
  if (!mlc?.setSetting) return;
  mlc.setSetting('token', value);
};

const setElectronUser = (value: User | null) => {
  if (typeof window === 'undefined') return;
  const mlc = (window as any).mlc;
  if (!mlc?.setSetting) return;
  mlc.setSetting('user', value);
};

const setElectronLockState = (locked: boolean) => {
  if (typeof window === 'undefined') return;
  const mlc = (window as any).mlc;
  if (!mlc?.setLockState) return;
  mlc.setLockState(Boolean(locked));
};

type SortOrder = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'custom';

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

  const baseCandidate = task.dueDate ? new Date(task.dueDate) : new Date();
  const base = isNaN(baseCandidate.getTime()) ? new Date() : baseCandidate;
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
      const first = sorted[0] ?? currentDay;
      const daysUntil = (7 - currentDay) + first;
      next.setDate(base.getDate() + daysUntil);
    } else {
      next.setDate(base.getDate() + (nextDay - currentDay));
    }
    return next.toISOString();
  }

  return null;
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

// normalizeNoteType now comes from @repo/shared (decrypt-aware single source of
// truth) so the store classifies a still-encrypted project `type` correctly and
// folders never leak into the notes list — see packages/shared/src/noteType.ts.

const parseNoteDateValue = (value: unknown): string => {
  if (typeof value !== 'string') return new Date().toISOString();
  try {
    return decrypt(value);
  } catch {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : value;
  }
};

const parseNoteOrder = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    try {
      const decrypted = decrypt(value);
      const num = Number(decrypted);
      return isNaN(num) ? 0 : num;
    } catch {
      const num = Number(value);
      return isNaN(num) ? 0 : num;
    }
  }
  return 0;
};

const parseReminderOffsets = (value: string): number[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'number');
  } catch {
  }
  const num = Number(value);
  if (!Number.isNaN(num)) return [num];
  return [];
};

const toReminderOffsets = (value?: number | number[]): number[] => {
  if (Array.isArray(value)) return value.filter((offset) => typeof offset === 'number');
  if (typeof value === 'number') return [value];
  return [];
};

const reminderTimers = new Map<string, number[]>();

const scheduleWebReminder = (task: Task) => {
  if (typeof window === 'undefined') return;
  if (!task.reminderEnabled) {
    const existing = reminderTimers.get(task._id);
    if (existing && existing.length > 0) {
      existing.forEach((id) => clearTimeout(id));
      reminderTimers.delete(task._id);
    }
    return;
  }
  const existing = reminderTimers.get(task._id);
  if (!task.dueDate) {
    if (existing && existing.length > 0) {
      existing.forEach((id) => clearTimeout(id));
      reminderTimers.delete(task._id);
    }
    return;
  }
  const due = new Date(task.dueDate);
  if (isNaN(due.getTime())) {
    if (existing && existing.length > 0) {
      existing.forEach((id) => clearTimeout(id));
      reminderTimers.delete(task._id);
    }
    return;
  }
  const offsets = Array.isArray(task.reminderOffsetMinutes) && task.reminderOffsetMinutes.length > 0
    ? Array.from(new Set(task.reminderOffsetMinutes))
    : [0];
  const triggers = offsets.map((offset) => ({
    offset,
    delay: new Date(due.getTime() - offset * 60000).getTime() - Date.now()
  })).filter((t) => t.delay > 0);
  if (triggers.length === 0) {
    if (existing && existing.length > 0) {
      existing.forEach((id) => clearTimeout(id));
      reminderTimers.delete(task._id);
    }
    return;
  }
  if (existing && existing.length > 0) {
    existing.forEach((id) => clearTimeout(id));
  }
  const timeoutIds = triggers.map((t) => window.setTimeout(() => {
    if (!('Notification' in window)) return;
    const fire = () => {
      const body = t.offset === 0 ? 'Påminnelse' : `Påminnelse ${t.offset} minuter innan`;
      const n = new Notification(task.title, {
        body,
        data: { taskId: task._id, offsetMinutes: t.offset }
      } as any);
      n.onclick = () => {
        const url = `${window.location.origin}/app?taskId=${task._id}`;
        window.location.href = url;
      };
    };
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(() => {
        if (Notification.permission === 'granted') {
          fire();
        }
      });
      return;
    }
    if (Notification.permission !== 'granted') return;
    fire();
  }, t.delay));
  reminderTimers.set(task._id, timeoutIds);
};

const normalizeEncryptedNote = (note: Note): any => {
  const rawTitle = (note as any).__rawEncryptedTitle ?? note.title;
  const rawContent = (note as any).__rawEncryptedContent ?? note.content;
  const rawTags = (note as any).__rawEncryptedTags ?? note.tags;
  const rawIcon = (note as any).__rawEncryptedIcon ?? note.icon;
  const rawIconColor = (note as any).__rawEncryptedIconColor ?? (note as any).iconColor;
  const locked = parseNoteLocked(note.locked);
  return {
    ...note,
    title: typeof rawTitle === 'string' ? rawTitle : '',
    content: typeof rawContent === 'string' ? rawContent : '',
    tags: Array.isArray(rawTags) ? rawTags : [],
    icon: typeof rawIcon === 'string' ? rawIcon : undefined,
    iconColor: typeof rawIconColor === 'string' ? rawIconColor : undefined,
    type: normalizeNoteType(note.type ? (() => { try { return decrypt(note.type) as any; } catch { return note.type; } })() : 'note'),
    parentId: note.parentId ? (() => { try { return decrypt(note.parentId) } catch { return note.parentId } })() : null,
    locked: locked,
    order: parseNoteOrder((note as any).order),
    createdAt: parseNoteDateValue(note.createdAt),
    updatedAt: parseNoteDateValue(note.updatedAt),
    __rawEncryptedTitle: typeof rawTitle === 'string' ? rawTitle : '',
    __rawEncryptedContent: typeof rawContent === 'string' ? rawContent : '',
    __rawEncryptedTags: Array.isArray(rawTags) ? rawTags : [],
    __rawEncryptedIcon: typeof rawIcon === 'string' ? rawIcon : undefined,
    __rawEncryptedIconColor: typeof rawIconColor === 'string' ? rawIconColor : undefined,
  };
};

const materializeNotesFromEncrypted = (notes: Note[], unlockedIds: Set<string>): Note[] => {
  const normalized = notes.map(normalizeEncryptedNote);
  const noteMap = buildSecurityNoteMap(normalized as any);
  return normalized.map((note: any) => {
    const blocking = findBlockingLockedAncestor(note, noteMap as any, unlockedIds);
    if (blocking) {
      const isDirectlyLockedProject = blocking._id === note._id && note.type === 'project';
      let projectTitle = note.title;
      if (isDirectlyLockedProject) {
        try {
          projectTitle = decrypt(note.__rawEncryptedTitle || note.title);
        } catch {}
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
      title: (() => { try { return decrypt(note.__rawEncryptedTitle || note.title) } catch { return note.title } })(),
      content: (() => { try { return decrypt(note.__rawEncryptedContent || note.content) } catch { return note.content } })(),
      tags: Array.isArray(note.__rawEncryptedTags)
        ? note.__rawEncryptedTags.map((t: any) => { try { return decrypt(t) } catch { return t } })
        : [],
      icon: note.__rawEncryptedIcon ? (() => { try { return decrypt(note.__rawEncryptedIcon) } catch { return note.__rawEncryptedIcon } })() : undefined,
      iconColor: note.__rawEncryptedIconColor ? (() => { try { return decrypt(note.__rawEncryptedIconColor) } catch { return note.__rawEncryptedIconColor } })() : undefined,
      locked: parseNoteLocked(note.locked),
    };
  });
};

interface StoreState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;

  language: 'sv' | 'en';
  setLanguage: (lng: 'sv' | 'en') => void;

  notes: Note[];
  tasks: Task[];
  selectedNoteId: string | null;
  selectedTaskListId: string | null;
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
  searchQuery: string;
  sortOrder: SortOrder;
  activeTab: 'notes' | 'tasks';
  setActiveTab: (tab: 'notes' | 'tasks') => void;
  
  activeUsers: Record<string, User[]>;
  joinNote: (noteId: string) => void;
  leaveNote: (noteId: string) => void;
  pendingCreated: { notes: Record<string, number>; tasks: Record<string, number> };

  isAppLocked: boolean;
  setAppLocked: (locked: boolean) => void;
  appLockPasswordHash: string | null;
  setAppLockPassword: (password: string) => void;
  verifyAppLockPassword: (password: string) => boolean;
  autoLockTimeout: number; // in minutes
  setAutoLockTimeout: (minutes: number) => void;
  unlockedProtectedNoteIds: string[];
  
  fetchNotes: () => Promise<void>;
  fetchTasks: (parentNoteId?: string) => Promise<void>;
  selectNote: (id: string | null) => void;
  createNote: (title: string, parentId?: string | null, type?: 'note' | 'task_list' | 'project', order?: number, icon?: string) => Promise<void>;
  updateNote: (id: string, dataOrTitle?: string | Partial<Note>, content?: string, locked?: boolean, password?: string, icon?: string, type?: string, iconColor?: string) => Promise<void>;
  moveNote: (id: string, parentId: string | null, order: number) => Promise<void>;
  unlockNote: (id: string, password: string) => Promise<boolean>;
  deleteNote: (id: string) => Promise<void>;
  
  createTask: (title: string, parentNoteId?: string, dueDate?: string | null, options?: { description?: string; priority?: 'low' | 'medium' | 'high'; recurrenceType?: 'none' | 'daily' | 'weekly'; recurrenceDays?: number[]; reminderEnabled?: boolean; reminderOffsetMinutes?: number | number[] }) => Promise<void>;
  updateTask: (id: string, data: UpdateTaskDto) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  reorderTasks: (tasks: Task[]) => Promise<void>;
  assignTasksToList: (noteId: string) => Promise<void>;

  setSearchQuery: (query: string) => void;
  setSortOrder: (order: SortOrder) => void;
  initSocket: () => void;
  syncOfflineChanges: () => Promise<void>;
  hydrate: () => void;
  isHydrated: boolean;
}

export const useStore = create<StoreState>((set, get) => ({
  isHydrated: false,
  user: null,
  token: null,
  activeProjectId: null,
  setActiveProject: (id) => {
    set({ activeProjectId: id });
    localStorage.setItem('activeProjectId', id || '');
  },
  language: 'sv',
  setLanguage: (lng) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lng);
    }
    set({ language: lng });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    try {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        const token = localStorage.getItem('token');
        const language = (localStorage.getItem('language') as 'sv' | 'en') || 'sv';
        const activeTab = (localStorage.getItem('activeTab') as any) || 'notes';
        const savedSortOrder = (localStorage.getItem('sortOrder') as SortOrder) || 'date-desc';
        const selectedNoteId = localStorage.getItem('lastSelectedNoteId') || localStorage.getItem('selectedNoteId') || null;
        const selectedTaskListId = localStorage.getItem('lastSelectedTaskListId') || null;
        const activeProjectId = localStorage.getItem('activeProjectId') || null;
        const isElectron = Boolean((window as any).mlc?.isElectron);
        const isAppLocked = localStorage.getItem('isAppLocked') === 'true';
        const appLockPasswordHash = localStorage.getItem('appLockPasswordHash');
        const autoLockTimeout = parseInt(localStorage.getItem('autoLockTimeout') || '15', 10);

        const shouldLockOnLaunch = Boolean(token && appLockPasswordHash && isElectron);
        const nextLocked = appLockPasswordHash ? (shouldLockOnLaunch ? true : isAppLocked) : false;

        set({ user, token, language, activeTab, sortOrder: savedSortOrder, selectedNoteId, selectedTaskListId, activeProjectId, isAppLocked: nextLocked, appLockPasswordHash, autoLockTimeout, isHydrated: true });
        setElectronLockState(nextLocked);
        setApiToken(token || null);
        setSocketToken(token || null);
        if (token) setElectronToken(token);
        if (user) setElectronUser(user);
        if ((!token || !user) && (window as any).mlc?.getSetting) {
            Promise.all([
                (window as any).mlc.getSetting('token'),
                (window as any).mlc.getSetting('user'),
                (window as any).mlc.getSetting('apiBaseUrl').catch(() => null),
                (window as any).mlc.getSetting('apiUrl').catch(() => null),
                (window as any).mlc.getSetting('backendUrl').catch(() => null),
            ]).then(([storedToken, storedUser, storedApiBaseUrl, storedApiUrl, storedBackendUrl]) => {
                logElectronDataDebug('bootstrap-settings', {
                    hasStoredToken: Boolean(storedToken),
                    hasStoredUser: Boolean(storedUser),
                    hasStoredApiBaseUrl: Boolean(storedApiBaseUrl),
                    hasStoredApiUrl: Boolean(storedApiUrl),
                    hasStoredBackendUrl: Boolean(storedBackendUrl),
                });
                if (storedToken && !token) {
                    localStorage.setItem('token', String(storedToken));
                }
                if (storedUser && !user) {
                    const normalizedUser = typeof storedUser === 'string' ? JSON.parse(storedUser) : storedUser;
                    localStorage.setItem('user', JSON.stringify(normalizedUser));
                }
                const apiBaseCandidate = storedApiBaseUrl || storedApiUrl || storedBackendUrl;
                if (apiBaseCandidate && typeof apiBaseCandidate === 'string') {
                    setApiBaseUrl(apiBaseCandidate);
                    logElectronDataDebug('bootstrap-api-base-applied', {
                        apiBaseHost: (() => {
                            try { return new URL(getApiBaseUrl()).host; } catch { return 'invalid-url'; }
                        })(),
                    });
                }
                if (storedToken && !token) {
                    set({ token: String(storedToken) });
                    setApiToken(String(storedToken));
                    setSocketToken(String(storedToken));
                }
                if (storedUser && !user) {
                    set({ user: typeof storedUser === 'string' ? JSON.parse(storedUser) : storedUser });
                }
                if (storedToken && !nextLocked) {
                    get().fetchNotes();
                    get().fetchTasks();
                    get().initSocket();
                }
            }).catch(() => {});
        }
        if (!networkListenersReady) {
            networkListenersReady = true;
            window.addEventListener('online', () => {
                set({ isOffline: false, error: null });
                localStorage.removeItem('hideOfflineIndicator');
                get().syncOfflineChanges();
                get().fetchNotes();
                get().fetchTasks();
            });
            window.addEventListener('offline', () => {
                set({ isOffline: true, error: 'Offline-läge' });
            });
            set({ isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false });
        }
        if (token && !nextLocked) {
            get().fetchNotes();
            get().fetchTasks();
            get().initSocket();
        }
    } catch (e) {
        console.error('Failed to hydrate store', e);
        set({ isHydrated: true });
    }
  },

  login: async (username, password) => {
    try {
        const { user, token } = await api.login(username, password);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.removeItem('isAppLocked');
        set({ user, token, isAppLocked: false });
        setElectronLockState(false);
        setApiToken(token);
        setSocketToken(token);
        setElectronToken(token);
        setElectronUser(user);
        await get().fetchNotes();
        await get().fetchTasks();
        get().initSocket();
    } catch (error: any) {
        set({ error: error.message });
        throw error;
    }
  },

  register: async (username, password) => {
    try {
        const { user, token } = await api.register(username, password);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.removeItem('isAppLocked');
        set({ user, token, isAppLocked: false });
        setElectronLockState(false);
        setApiToken(token);
        setSocketToken(token);
        setElectronToken(token);
        setElectronUser(user);
        await get().fetchNotes();
        await get().fetchTasks();
        get().initSocket();
    } catch (error: any) {
        set({ error: error.message });
        throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setApiToken(null);
    setSocketToken(null);
    setElectronToken(null);
    setElectronUser(null);
    disconnectSocket();
    set({ user: null, token: null, notes: [], tasks: [], selectedNoteId: null, selectedTaskListId: null, isAppLocked: false, unlockedProtectedNoteIds: [] });
  },

  notes: [],
  tasks: [],
  unlockedProtectedNoteIds: [],
  pendingCreated: { notes: {}, tasks: {} },
  selectedNoteId: null,
  selectedTaskListId: null,
  isLoading: false,
  isOffline: false,
  error: null,
  searchQuery: '',
  sortOrder: 'date-desc',
  activeTab: 'notes',
  setActiveTab: (tab) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activeTab', tab);
    }
    set({ activeTab: tab });
  },
  
  activeUsers: {},
  isAppLocked: false,
  appLockPasswordHash: null,
  autoLockTimeout: 15,

  setAppLockPassword: (password) => {
      const hash = CryptoJS.SHA256(password).toString();
      localStorage.setItem('appLockPasswordHash', hash);
      set({ appLockPasswordHash: hash });
  },

  verifyAppLockPassword: (password) => {
      const { appLockPasswordHash } = get();
      const stored = typeof window !== 'undefined' ? localStorage.getItem('appLockPasswordHash') : null;
      const hash = appLockPasswordHash || stored || '';
      if (!hash) return false;
      return CryptoJS.SHA256(password).toString() === hash;
  },

  setAppLocked: (locked) => {
    if (typeof window !== 'undefined') {
        if (locked) localStorage.setItem('isAppLocked', 'true');
        else localStorage.removeItem('isAppLocked');
    }
    if (locked) {
        // Clear sensitive data from memory to ensure it's not accessible via DevTools/Inspector
        set({ 
            isAppLocked: true, 
            notes: [], 
            tasks: [], 
            unlockedProtectedNoteIds: [],
            activeUsers: {},
            selectedNoteId: null,
            selectedTaskListId: null,
            pendingCreated: { notes: {}, tasks: {} }
        });
        disconnectSocket();
    } else {
        set({ isAppLocked: false });
        // Re-fetch data
        get().fetchNotes();
        get().fetchTasks();
        get().initSocket();
    }
    setElectronLockState(locked);
  },

  setAutoLockTimeout: (minutes) => {
      if (typeof window !== 'undefined') {
          localStorage.setItem('autoLockTimeout', minutes.toString());
      }
      set({ autoLockTimeout: minutes });
  },

  joinNote: (noteId) => {
      const { user } = get();
      if (user && socket.connected) {
          socket.emit('note:join', { noteId, user });
      }
  },

  leaveNote: (noteId) => {
      const { user } = get();
      if (user && socket.connected) {
          socket.emit('note:leave', { noteId, user });
      }
  },

  initSocket: () => {
    if (get().isAppLocked) return;
    if (!get().token) return;
    connectSocket();
    
    socket.off('connect');
    socket.on('connect', () => {
      console.log('Connected to socket server');
      get().syncOfflineChanges(); // Try to sync when reconnected
    });

    socket.off('note:active-users');
    socket.on('note:active-users', ({ noteId, users }: { noteId: string, users: User[] }) => {
        set(state => ({
            activeUsers: {
                ...state.activeUsers,
                [noteId]: users
            }
        }));
    });

    socket.off('connect_error');
    socket.on('connect_error', (err: any) => {
        set({ error: err?.message || 'Socket connection error' });
    });

    socket.off('disconnect');
    socket.on('disconnect', () => {
        set({ error: 'Socket disconnected' });
    });

    socket.off('note:created');
    socket.on('note:created', (newNote: Note) => {
      const securedIncoming = materializeNotesFromEncrypted([normalizeEncryptedNote(newNote), ...get().notes], new Set(get().unlockedProtectedNoteIds));
      const decryptedNote = securedIncoming.find((n) => n._id === newNote._id);
      if (!decryptedNote) return;
      const exists = get().notes.find(n => n._id === decryptedNote._id);
      const pending = get().pendingCreated.notes[decryptedNote._id];
      if (exists || pending) {
          set(state => {
              const nextPending = { ...state.pendingCreated.notes };
              delete nextPending[decryptedNote._id];
              return { pendingCreated: { ...state.pendingCreated, notes: nextPending } };
          });
          return;
      }
      // Batch the state update and DB operation
      requestAnimationFrame(() => {
        set(state => ({ notes: uniqBy([decryptedNote, ...state.notes], '_id') }));
        db.saveNote(decryptedNote);
      });
    });

    socket.off('note:updated');
    socket.on('note:updated', (updatedNote: Note) => {
        const securedIncoming = materializeNotesFromEncrypted(get().notes.map((n) => (n._id === updatedNote._id ? normalizeEncryptedNote(updatedNote) : n)) as any, new Set(get().unlockedProtectedNoteIds));
        const decryptedNote = securedIncoming.find((n) => n._id === updatedNote._id);
        if (!decryptedNote) return;
        
        // Use requestAnimationFrame to batch this potentially expensive operation
        requestAnimationFrame(() => {
            set(state => {
                const currentNote = state.notes.find(n => n._id === decryptedNote._id);
                if (currentNote) {
                    // Conflict handling: Merge using deepmerge based on updatedAt
                    const localTime = new Date(currentNote.updatedAt).getTime();
                    const remoteTime = new Date(decryptedNote.updatedAt).getTime();

                    if (localTime > remoteTime) {
                        // Local is newer, ignore remote (or merge carefully)
                        // For now, let's assume local wins if strictly newer
                         return {};
                    }
                }
                
                // Remote is newer or no local note, accept remote
                const newNotes = securedIncoming;
                
                // Preserve unlocked content if still locked in backend but unlocked locally
                if (state.selectedNoteId === decryptedNote._id) {
                     const currentNote = state.notes.find(n => n._id === decryptedNote._id);
                     if (currentNote && !currentNote.locked && decryptedNote.locked) {
                         // If we have unlocked content locally, keep it?
                         // Or re-lock? If remote says locked, it might be re-locked.
                         // But if we are editing, we don't want to be locked out suddenly.
                         // Let's rely on 'locked' status.
                     }
                }
                return { notes: newNotes };
            });
            db.saveNote(decryptedNote); // Cache incoming
        });
    });

    socket.off('note:deleted');
    socket.on('note:deleted', (noteId: string) => {
        set(state => ({
            notes: state.notes.filter(n => n._id !== noteId),
            selectedNoteId: state.selectedNoteId === noteId ? null : state.selectedNoteId,
            selectedTaskListId: state.selectedTaskListId === noteId ? null : state.selectedTaskListId
        }));
        db.deleteNote(noteId); // Remove from cache
    });

    socket.off('notes:reordered');
    socket.on('notes:reordered', (notes: Array<{ _id: string; order: any }>) => {
      set(state => {
        const orderMap = new Map(notes.map(n => [n._id, parseNoteOrder(n.order)]));
        const next = state.notes.map(n => (orderMap.has(n._id) ? { ...n, order: orderMap.get(n._id)! } : n));
        return { notes: next };
      });
      for (const n of notes) {
        const existing = get().notes.find(x => x._id === n._id);
        if (existing) db.saveNote(existing);
      }
    });

    socket.off('task:created');
    socket.on('task:created', (newTask: any) => {
        const decryptedTask = {
            ...newTask,
            title: decrypt(newTask.title),
            description: decrypt(newTask.description),
            completed: parseTaskCompleted(newTask.completed),
            priority: parseTaskPriority(newTask.priority),
            createdAt: decrypt(newTask.createdAt),
            updatedAt: decrypt(newTask.updatedAt),
            position: (() => {
                try {
                    const decrypted = decrypt(String(newTask.position));
                    const num = Number(decrypted);
                    return isNaN(num) ? 0 : num;
                } catch {
                    return 0;
                }
            })(),
            recurrenceType: newTask.recurrenceType ? (() => { try { return decrypt(newTask.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
            recurrenceDays: newTask.recurrenceDays ? (() => { try { return JSON.parse(decrypt(newTask.recurrenceDays)) } catch { return [] } })() : [],
            reminderEnabled: newTask.reminderEnabled ? (() => { try { return decrypt(newTask.reminderEnabled) === 'true' } catch { return false } })() : false,
            reminderOffsetMinutes: newTask.reminderOffsetMinutes ? (() => { try { return parseReminderOffsets(decrypt(newTask.reminderOffsetMinutes)); } catch { return []; } })() : [],
        };
        set(state => {
            const exists = state.tasks.some(t => t._id === decryptedTask._id);
            const pending = state.pendingCreated.tasks[decryptedTask._id];
            if (exists || pending) {
                const nextPending = { ...state.pendingCreated.tasks };
                delete nextPending[decryptedTask._id];
                return { pendingCreated: { ...state.pendingCreated, tasks: nextPending } };
            }
            return { tasks: uniqBy([decryptedTask, ...state.tasks], '_id') };
        });
        db.saveTask(decryptedTask);
        scheduleWebReminder(decryptedTask);
    });

    socket.off('task:updated');
    socket.on('task:updated', (updatedTask: any) => {
        const decryptedTask = {
            ...updatedTask,
            title: decrypt(updatedTask.title),
            description: decrypt(updatedTask.description),
            completed: parseTaskCompleted(updatedTask.completed),
            priority: parseTaskPriority(updatedTask.priority),
            createdAt: decrypt(updatedTask.createdAt),
            updatedAt: decrypt(updatedTask.updatedAt),
            position: (() => {
                try {
                    const decrypted = decrypt(String(updatedTask.position));
                    const num = Number(decrypted);
                    return isNaN(num) ? 0 : num;
                } catch {
                    return 0;
                }
            })(),
            recurrenceType: updatedTask.recurrenceType ? (() => { try { return decrypt(updatedTask.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
            recurrenceDays: updatedTask.recurrenceDays ? (() => { try { return JSON.parse(decrypt(updatedTask.recurrenceDays)) } catch { return [] } })() : [],
            reminderEnabled: updatedTask.reminderEnabled ? (() => { try { return decrypt(updatedTask.reminderEnabled) === 'true' } catch { return false } })() : false,
            reminderOffsetMinutes: updatedTask.reminderOffsetMinutes ? (() => { try { return parseReminderOffsets(decrypt(updatedTask.reminderOffsetMinutes)); } catch { return []; } })() : [],
        };
        set(state => ({
            tasks: state.tasks.map(t => t._id === decryptedTask._id ? decryptedTask : t)
        }));
        db.saveTask(decryptedTask);
        scheduleWebReminder(decryptedTask);
    });

    socket.off('task:deleted');
    socket.on('task:deleted', (taskId: string) => {
        set(state => ({
            tasks: state.tasks.filter(t => t._id !== taskId)
        }));
        db.deleteTask(taskId);
        const existing = reminderTimers.get(taskId);
        if (existing && existing.length > 0) {
          existing.forEach((id) => clearTimeout(id));
          reminderTimers.delete(taskId);
        }
    });

    socket.off('tasks:reordered');
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
                    return { ...t, position: nextPosition };
                }
                return t;
            });
            // Also update DB for all changed tasks
            newTasks.forEach(t => db.saveTask(t));
            return { tasks: newTasks };
        });
    });
  },

  syncOfflineChanges: async () => {
      if (get().isAppLocked) return;
      // Sync Notes
      const pendingNotes = await db.getPendingSyncNotes();
      for (const note of pendingNotes) {
          try {
              if (note.deleted) {
                  await api.deleteNote(note._id);
                  await db.deleteNote(note._id);
              } else if (note._id.startsWith('temp-')) {
                  const created = await api.createNote({ 
                      title: note.title, 
                      content: note.content, 
                      parentId: note.parentId,
                      order: Number(note.order ?? 0),
                      icon: note.icon,
                      type: note.type
                  });
                  set(state => ({
                      notes: state.notes.map(n => n._id === note._id ? created : n),
                      selectedNoteId: state.selectedNoteId === note._id ? created._id : state.selectedNoteId,
                      selectedTaskListId: state.selectedTaskListId === note._id ? created._id : state.selectedTaskListId
                  }));
                  await db.deleteNote(note._id);
                  await db.saveNote(created, false);
              } else {
                  const noteWithPassword = note as Note & { password?: string };
                  await api.updateNote(note._id, {
                      title: note.title,
                      content: note.content,
                      locked: Boolean(note.locked),
                      password: noteWithPassword.password,
                      icon: note.icon,
                      type: note.type,
                      order: Number(note.order ?? 0)
                  });
                  await db.saveNote(note, false);
              }
          } catch (e) {
              const status = (e as any)?.status;
              const message = String((e as any)?.message ?? '');
              if (status === 404 || message.toLowerCase().includes('not found')) {
                  set(state => ({
                      notes: state.notes.filter(n => n._id !== note._id),
                      selectedNoteId: state.selectedNoteId === note._id ? null : state.selectedNoteId,
                      selectedTaskListId: state.selectedTaskListId === note._id ? null : state.selectedTaskListId
                  }));
                  await db.deleteNote(note._id);
                  continue;
              }
              console.error('Sync failed for note', note._id, e);
          }
      }

      // Sync Tasks
      const pendingTasks = await db.getPendingSyncTasks();
      for (const task of pendingTasks) {
          try {
              if (task.deleted) {
                  await api.deleteTask(task._id);
                  await db.deleteTask(task._id);
              } else if (task._id.startsWith('temp-')) {
                  const created = await api.createTask({
                      title: task.title,
                      parentNoteId: task.parentNoteId,
                      description: task.description,
                      priority: task.priority,
                      dueDate: task.dueDate,
                      clientId: task.clientId,
                      recurrenceType: task.recurrenceType,
                      recurrenceDays: task.recurrenceDays,
                      reminderEnabled: task.reminderEnabled,
                      reminderOffsetMinutes: task.reminderOffsetMinutes
                  });
                  set(state => ({
                      tasks: state.tasks.map(t => t._id === task._id ? created : t)
                  }));
                  await db.deleteTask(task._id);
                  await db.saveTask(created, false);
              } else {
                  await api.updateTask(task._id, {
                      title: task.title,
                      completed: task.completed,
                      description: task.description,
                      priority: task.priority,
                      dueDate: task.dueDate,
                      recurrenceType: task.recurrenceType,
                      recurrenceDays: task.recurrenceDays,
                      reminderEnabled: task.reminderEnabled,
                      reminderOffsetMinutes: task.reminderOffsetMinutes
                  });
                  await db.saveTask(task, false);
              }
          } catch (e) {
               const status = (e as any)?.status;
               const message = String((e as any)?.message ?? '');
               if (status === 404 || message.toLowerCase().includes('not found')) {
                   set(state => ({
                       tasks: state.tasks.filter(t => t._id !== task._id)
                   }));
                   await db.deleteTask(task._id);
                   continue;
               }
               console.error('Sync failed for task', task._id, e);
          }
      }
  },

  fetchNotes: async () => {
    if (get().isAppLocked) {
      set({ isLoading: false });
      return;
    }
    logElectronDataDebug('fetchNotes-start', {
      hasToken: Boolean(get().token),
      hasUser: Boolean(get().user),
      apiBaseHost: (() => {
        try { return new URL(getApiBaseUrl()).host; } catch { return 'invalid-url'; }
      })(),
    });
    set({ isLoading: true, error: null });
    try {
        const cachedNotes = await db.getAllNotes();
        const validNotesRaw = cachedNotes.filter(n => !(n as any).deleted);
        const validNotes = materializeNotesFromEncrypted(validNotesRaw as any, new Set(get().unlockedProtectedNoteIds));
        logElectronDataDebug('fetchNotes-cache-loaded', {
          cachedCount: cachedNotes.length,
          validCachedCount: validNotes.length,
        });
        if (validNotes.length > 0) {
            set({ notes: validNotes, isLoading: false });
        } else {
            set({ notes: [], isLoading: false });
        }
    } catch (e) {
        console.error('Failed to load notes from DB', e);
    }

    try {
      // Always try to fetch, regardless of navigator.onLine status
      // This fixes issues in Electron where onLine might be false reported
      const withTimeout = <T,>(promise: Promise<T>, ms: number) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Request timed out')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
      };

      const encryptedNotes = await withTimeout(api.fetchNotes(), 8000);
      const safeEncryptedNotes = Array.isArray(encryptedNotes) ? encryptedNotes : [];
      const notes = materializeNotesFromEncrypted(safeEncryptedNotes as any, new Set(get().unlockedProtectedNoteIds));
      logElectronDataDebug('fetchNotes-server-loaded', {
        encryptedCount: safeEncryptedNotes.length,
        materializedCount: notes.length,
      });
      
      const pendingNotes = await db.getPendingSyncNotes();
      
      const mergedNotes = [...notes];
      const serverNoteMap = new Map(notes.map(n => [n._id, n]));
      
      for (const pNote of pendingNotes) {
          if (pNote.deleted) {
              const idx = mergedNotes.findIndex(n => n._id === pNote._id);
              if (idx !== -1) mergedNotes.splice(idx, 1);
          } else {
              if (serverNoteMap.has(pNote._id)) {
                  const idx = mergedNotes.findIndex(n => n._id === pNote._id);
                  if (idx !== -1) mergedNotes[idx] = pNote;
              } else {
                  mergedNotes.push(pNote);
              }
          }
      }

      const nextNotesRaw = uniqBy(mergedNotes, '_id');
      const nextNotes = materializeNotesFromEncrypted(nextNotesRaw as any, new Set(get().unlockedProtectedNoteIds));
      const typeCounts = nextNotes.reduce((acc: Record<string, number>, note: any) => {
        const t = normalizeNoteType(note?.type);
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {});
      logElectronDataDebug('fetchNotes-merged', {
        mergedCount: nextNotes.length,
        typeCounts,
        activeProjectId: get().activeProjectId || null,
      });
      set({ notes: nextNotes, isLoading: false });
      if (typeof window !== 'undefined') {
        if (nextNotes.length === 0) {
          localStorage.removeItem('lastSelectedNoteId');
          localStorage.removeItem('selectedNoteId');
        } else {
          const selectedId = get().selectedNoteId;
          if (selectedId && !nextNotes.some(n => n._id === selectedId)) {
            localStorage.removeItem('lastSelectedNoteId');
            localStorage.removeItem('selectedNoteId');
            set({ selectedNoteId: null });
          }
          const activeProjectId = get().activeProjectId;
          if (activeProjectId && !nextNotes.some(n => n._id === activeProjectId)) {
            localStorage.removeItem('activeProjectId');
            set({ activeProjectId: null });
          }
        }
      }

      // Batch save to DB to prevent UI freezing
      const chunkSize = 50;
      for (let i = 0; i < nextNotes.length; i += chunkSize) {
          const chunk = nextNotes.slice(i, i + chunkSize);
          await Promise.all(chunk.map(n => db.saveNote(n)));
          // Yield to event loop
          await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (error: any) {
      logElectronDataDebug('fetchNotes-error', {
        message: error?.message || 'unknown-error',
        name: error?.name || 'Error',
      });
      set({ error: error.message, isLoading: false });
    }
  },

  fetchTasks: async (parentNoteId) => {
    if (get().isAppLocked) {
      set({ isLoading: false });
      return;
    }
    set({ isLoading: true, error: null });
    try {
        const cachedTasks = await db.getAllTasks();
        const validTasks = cachedTasks.filter(t => !(t as any).deleted);
        if (validTasks.length > 0) {
             set({ tasks: validTasks, isLoading: false });
             validTasks.forEach(scheduleWebReminder);
        } else {
             set({ tasks: [], isLoading: false });
        }
    } catch (e) {
        console.error('Failed to load tasks from DB', e);
    }

    try {
        // Always try to fetch, regardless of navigator.onLine status
        const encryptedTasks = await api.fetchTasks(parentNoteId);
        const tasks = await api.decryptTasks(encryptedTasks);
        
        const pendingTasks = await db.getPendingSyncTasks();
        
        const currentTasks = get().tasks;
        
        // Keep tasks that are NOT in the scope of the new data
        // If fetching specific list, keep others.
        // If fetching all, keep none (replace all).
        const keptTasks = parentNoteId 
            ? currentTasks.filter(t => t.parentNoteId !== parentNoteId)
            : [];
            
        // Merge: Fresh first, then kept. uniqBy will keep the first occurrence (Fresh)
        const mergedTasks = uniqBy([...tasks, ...keptTasks], '_id');
        const serverTaskMap = new Map(tasks.map(t => [t._id, t]));
        
        for (const pTask of pendingTasks) {
            if (pTask.deleted) {
                 const idx = mergedTasks.findIndex(t => t._id === pTask._id);
                 if (idx !== -1) mergedTasks.splice(idx, 1);
            } else {
                 // Only include if it belongs to the requested list (or if we requested all)
                 // OR if it was already in the set (e.g. kept from other list)
                 // But simplest is: Update if exists, Add if belongs to requested scope
                 
                 const idx = mergedTasks.findIndex(t => t._id === pTask._id);
                 if (idx !== -1) {
                     mergedTasks[idx] = pTask;
                 } else {
                     const belongs = !parentNoteId || pTask.parentNoteId === parentNoteId;
                     if (belongs) {
                         mergedTasks.push(pTask);
                     }
                 }
            }
        }

        set({ tasks: uniqBy(mergedTasks, '_id'), isLoading: false });
        
        // Batch save to DB to prevent UI freezing
        const chunkSize = 50;
        for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(t => db.saveTask(t)));
            // Yield to event loop
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        tasks.forEach(scheduleWebReminder);
    } catch (error: any) {
        set({ error: error.message, isLoading: false });
    }
  },

  selectNote: (id) => {
    const { activeTab } = get();
    if (typeof window !== 'undefined') {
      if (activeTab === 'tasks') {
        if (id) localStorage.setItem('lastSelectedTaskListId', id);
        else localStorage.removeItem('lastSelectedTaskListId');
      } else {
        if (id) {
          localStorage.setItem('lastSelectedNoteId', id);
          localStorage.setItem('selectedNoteId', id);
        } else {
          localStorage.removeItem('lastSelectedNoteId');
          localStorage.removeItem('selectedNoteId');
        }
      }
    }
    set(activeTab === 'tasks' ? { selectedTaskListId: id } : { selectedNoteId: id });
  },

  createNote: async (title, parentId = null, type: 'note' | 'task_list' | 'project' = 'note', order?: number, icon?: string) => {
    set({ isLoading: true, error: null });
    const clientId = getUUID();
    try {
      const initialContent = JSON.stringify([
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ]);
      
      const newNote = await api.createNote({ title, content: initialContent, parentId, type, order, icon, clientId } as any);
      set((state) => ({
        notes: uniqBy([newNote, ...state.notes], '_id'),
        ...(type === 'task_list' ? { selectedTaskListId: newNote._id } : { selectedNoteId: newNote._id }),
        isLoading: false
      }));
      set(state => ({
        pendingCreated: { 
          ...state.pendingCreated, 
          notes: { ...state.pendingCreated.notes, [newNote._id]: Date.now() + 10000 } 
        }
      }));
      setTimeout(() => {
        set(state => {
          const next = { ...state.pendingCreated.notes };
          delete next[newNote._id];
          return { pendingCreated: { ...state.pendingCreated, notes: next } };
        });
      }, 10000);
      db.saveNote(newNote);
    } catch (error: any) {
      const tempId = `temp-${Date.now()}`;
      const tempNote = {
          _id: tempId,
          userId: 'local',
          title,
          content: JSON.stringify([
            { type: 'paragraph', children: [{ text: '' }] }
          ]),
          tags: [],
          parentId,
          locked: false,
          icon: icon,
          order: order ?? 0,
          type,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
      } as Note;
      set((state) => ({
        notes: [tempNote, ...state.notes],
        ...(type === 'task_list' ? { selectedTaskListId: tempNote._id } : { selectedNoteId: tempNote._id }),
        isLoading: false,
        error: 'Offline: Note created locally and will sync when online'
      }));
      await db.saveNote(tempNote, true);
    }
  },

  updateNote: async (id, dataOrTitle, content, locked, password, icon, type, iconColor) => {
    // Handle overload: if second arg is object, it's Partial<Note>
    let updates: any = {};
    if (typeof dataOrTitle === 'object' && dataOrTitle !== null) {
        updates = dataOrTitle;
    } else {
        // Legacy positional arguments
        if (dataOrTitle !== undefined) updates.title = dataOrTitle;
        if (content !== undefined) updates.content = content;
        if (locked !== undefined) updates.locked = locked;
        if (password !== undefined) updates.password = password;
        if (icon !== undefined) updates.icon = icon;
        if (type !== undefined) updates.type = type;
        if (iconColor !== undefined) updates.iconColor = iconColor;
    }

    const stateUpdates = { ...updates };
    const currentBeforeLock = get().notes.find(n => n._id === id) as any;
    if (updates.locked === true) {
        if (currentBeforeLock) {
            stateUpdates.__rawEncryptedTitle = currentBeforeLock.__rawEncryptedTitle || encrypt(currentBeforeLock.title || '');
            stateUpdates.__rawEncryptedContent = currentBeforeLock.__rawEncryptedContent || encrypt(currentBeforeLock.content || '');
            stateUpdates.__rawEncryptedTags = currentBeforeLock.__rawEncryptedTags || (Array.isArray(currentBeforeLock.tags) ? currentBeforeLock.tags.map((t: string) => encrypt(t)) : []);
            stateUpdates.__rawEncryptedIcon = currentBeforeLock.__rawEncryptedIcon || (currentBeforeLock.icon ? encrypt(currentBeforeLock.icon) : undefined);
            stateUpdates.__rawEncryptedIconColor = currentBeforeLock.__rawEncryptedIconColor || (currentBeforeLock.iconColor ? encrypt(currentBeforeLock.iconColor) : undefined);
        }
        stateUpdates.title = 'Låst anteckning';
        stateUpdates.content = '';
        set((state) => ({ unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((item) => item !== id) }));
    }

    // Optimistic update
    set((state) => ({
      notes: state.notes.map((n) => {
        if (n._id === id) {
            return {
                ...n,
                ...stateUpdates,
                updatedAt: new Date().toISOString()
            };
        }
        return n;
      })
    }));
    
    // Save to DB (optimistic)
    const currentNote = get().notes.find(n => n._id === id);
    if (currentNote) {
        await db.saveNote(currentNote, true); // Mark pending sync initially
    }

    if (id.startsWith('temp-')) {
      return; // Don't call API for temporary notes
    }

    try {
      const payload: any = { ...updates };
      payload.updatedAt = encrypt(new Date().toISOString());

      const updatedNote = await api.updateNote(id, payload);
      set((state) => ({
        notes: materializeNotesFromEncrypted(state.notes.map((n) => (n._id === id ? updatedNote : n)) as any, new Set(state.unlockedProtectedNoteIds))
      }));
      await db.saveNote(updatedNote, false); // Mark synced
    } catch (error: any) {
      set({ error: error.message });
      // Keep pending sync in DB
    }
  },

  moveNote: async (id, parentId, order) => {
      // Optimistic
      set((state) => ({
          notes: state.notes.map(n => n._id === id ? { ...n, parentId, order, updatedAt: new Date().toISOString() } : n)
      }));

      const currentNote = get().notes.find(n => n._id === id);
      if (currentNote) await db.saveNote(currentNote, true);

      if (id.startsWith('temp-')) return;

      try {
          // We need a way to pass partial update to api.updateNote
          // api.updateNote takes UpdateNoteDto which has optional fields.
          await api.updateNote(id, { parentId, order });
          // Note: api.updateNote returns the full note, so we could update state with it
          // But we already did optimistic.
          const updatedNote = { ...currentNote!, parentId, order, updatedAt: new Date().toISOString() };
           await db.saveNote(updatedNote, false);
      } catch (error: any) {
          set({ error: error.message });
      }
  },

  unlockNote: async (id, password) => {
    try {
      const { success, content, title, unlockedId } = await api.verifyLock(id, password);
      if (success) {
        const effectiveUnlockId = unlockedId || id;
        set((state) => ({
          unlockedProtectedNoteIds: Array.from(new Set([...state.unlockedProtectedNoteIds, effectiveUnlockId])),
          notes: state.notes.map((n) => (n._id === id ? { ...n, content, ...(title ? { title } : {}) } : n)),
        }));
        await get().fetchNotes();
        return true;
      }
      return false;
    } catch (error: any) {
      set({ error: error.message });
      return false;
    }
  },

  deleteNote: async (id) => {
    set({ isLoading: true, error: null });
    // Optimistic delete
    const previousNotes = get().notes;
    set((state) => ({
      notes: state.notes.filter((n) => n._id !== id),
      selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
      selectedTaskListId: state.selectedTaskListId === id ? null : state.selectedTaskListId,
      isLoading: false
    }));

    if (id.startsWith('temp-')) {
        await db.deleteNote(id);
        return;
    }

    try {
      await api.deleteNote(id);
      await db.deleteNote(id);
    } catch (error: any) {
      // Offline delete
      await db.markAsDeleted(id);
      set({ error: 'Offline: Note marked for deletion', isLoading: false });
    }
  },

  createTask: async (title, parentNoteId, dueDate, options) => {
      const parsedOffsets = toReminderOffsets(options?.reminderOffsetMinutes);
      const reminderOffsets = options?.reminderEnabled
        ? (parsedOffsets.length > 0 ? parsedOffsets : [0])
        : [];
      const clientId = getUUID();
      try {
          const newTask = await api.createTask({ 
              title, 
              parentNoteId, 
              priority: options?.priority || 'medium', 
              description: options?.description || '',
              clientId, 
              dueDate: dueDate || null,
              recurrenceType: options?.recurrenceType,
              recurrenceDays: options?.recurrenceDays,
              reminderEnabled: options?.reminderEnabled,
              reminderOffsetMinutes: reminderOffsets
          });
          set(state => ({ 
              tasks: uniqBy([newTask, ...state.tasks], '_id'),
              pendingCreated: { 
                  ...state.pendingCreated, 
                  tasks: { ...state.pendingCreated.tasks, [newTask._id]: Date.now() + 10000 } 
              }
          }));
          setTimeout(() => {
              set(state => {
                  const next = { ...state.pendingCreated.tasks };
                  delete next[newTask._id];
                  return { pendingCreated: { ...state.pendingCreated, tasks: next } };
              });
          }, 10000);
          db.saveTask(newTask);
          scheduleWebReminder(newTask);
      } catch (error: any) {
          // Offline creation
          const tempId = `temp-${Date.now()}`;
          const tempTask = {
              _id: tempId,
              userId: 'local',
              clientId,
              title,
              description: options?.description || '',
              dueDate: dueDate || null,
              parentNoteId,
              completed: false,
              priority: options?.priority || 'medium',
              position: 0,
              recurrenceType: options?.recurrenceType || 'none',
              recurrenceDays: options?.recurrenceDays || [],
              reminderEnabled: options?.reminderEnabled || false,
              reminderOffsetMinutes: reminderOffsets,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
          } as Task;
          set(state => ({
              tasks: [tempTask, ...state.tasks],
              pendingCreated: {
                  ...state.pendingCreated,
                  tasks: { ...state.pendingCreated.tasks, [tempId]: Date.now() + 10000 }
              }
          }));
          await db.saveTask(tempTask, true);
          scheduleWebReminder(tempTask);
      }
  },

  updateTask: async (id, data) => {
      const previousTask = get().tasks.find(t => t._id === id);
      const mergedTask = previousTask ? { ...previousTask, ...data } as Task : null;
      const shouldCreateNext = data.completed === true && previousTask && !previousTask.completed;

      if (shouldCreateNext && mergedTask && mergedTask.recurrenceType && mergedTask.recurrenceType !== 'none') {
          const nextDueDate = getNextRecurringDueDate(mergedTask);
          if (nextDueDate) {
              await get().createTask(
                  mergedTask.title,
                  mergedTask.parentNoteId || undefined,
                  nextDueDate,
                  {
                      description: mergedTask.description,
                      priority: mergedTask.priority,
                  recurrenceType: mergedTask.recurrenceType,
                  recurrenceDays: mergedTask.recurrenceDays,
                  reminderEnabled: mergedTask.reminderEnabled,
                  reminderOffsetMinutes: toReminderOffsets(mergedTask.reminderOffsetMinutes)
                  }
              );
          }
      }

      // Optimistic
      set(state => ({
          tasks: state.tasks.map(t => t._id === id ? { ...t, ...data, updatedAt: new Date().toISOString() } : t)
      }));
      
      const currentTask = get().tasks.find(t => t._id === id);
      if (currentTask) {
          await db.saveTask(currentTask, true); // Mark pending sync
          scheduleWebReminder(currentTask);
      }

      if (id.startsWith('temp-')) return;

      try {
          const updatedTask = await api.updateTask(id, data);
          set(state => ({
              tasks: state.tasks.map(t => t._id === id ? updatedTask : t)
          }));
          await db.saveTask(updatedTask, false);
      } catch (error: any) {
          set({ error: error.message });
          // Keep pending sync
      }
  },

  deleteTask: async (id) => {
      // Optimistic
      set(state => ({
          tasks: state.tasks.filter(t => t._id !== id)
      }));
      const existing = reminderTimers.get(id);
      if (existing && existing.length > 0) {
        existing.forEach((timeoutId) => clearTimeout(timeoutId));
        reminderTimers.delete(id);
      }

      if (id.startsWith('temp-')) {
          await db.deleteTask(id);
          return;
      }

      try {
          await api.deleteTask(id);
          await db.deleteTask(id);
      } catch (error: any) {
          await db.markTaskAsDeleted(id);
          set({ error: 'Offline: Task marked for deletion' });
      }
  },

  reorderTasks: async (tasks) => {
      // Optimistic
      set({ tasks });
      
      // Update DB for all tasks
      for (const task of tasks) {
          await db.saveTask(task, true);
      }

      try {
          const payload = tasks.map((t, index) => ({ _id: t._id, position: index }));
          await api.reorderTasks(payload);
          // Mark as synced? Reordering might not return full task objects, 
          // but if successful, we can assume local state is correct.
          // Ideally we should mark them as not pending sync anymore.
          for (const task of tasks) {
              await db.saveTask(task, false);
          }
      } catch (error: any) {
          set({ error: error.message });
      }
  },
 
  assignTasksToList: async (noteId) => {
      set({ isLoading: true, error: null });
      try {
          await api.assignTasksToList(noteId);
          await get().fetchTasks();
          set({ isLoading: false });
      } catch (error: any) {
          set({ error: error.message, isLoading: false });
      }
  },
  
  deleteOrphanTasks: async () => {
      set({ isLoading: true, error: null });
      try {
          const state = get();
          const orphans = state.tasks.filter(t => !t.parentNoteId);
          for (const t of orphans) {
              await get().deleteTask(t._id);
          }
          await get().fetchTasks();
          set({ isLoading: false });
      } catch (error: any) {
          set({ error: error.message, isLoading: false });
      }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortOrder: (order) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sortOrder', order);
    }
    set({ sortOrder: order });
  },
}));
