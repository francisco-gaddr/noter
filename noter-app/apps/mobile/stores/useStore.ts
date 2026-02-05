import { create } from 'zustand';
import 'react-native-get-random-values';
import * as Crypto from 'expo-crypto';
import { Note, Task, CreateNoteDto, UpdateNoteDto, CreateTaskDto, UpdateTaskDto, encrypt, decrypt } from '@repo/shared';
import { fetchWithAuth, login as apiLogin, register as apiRegister, setAuthToken, initApiUrl, setUnauthorizedHandler } from '../services/api';
import * as Database from '../services/database';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';

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
  
  // UI Actions
  setActiveProject: (id: string | null) => void;
  setViewMode: (mode: 'list' | 'tree') => void;
  init: () => Promise<void>;
  
  // Socket Actions
  connectSocket: () => void;

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
  
  // Offline Sync
  syncOfflineChanges: () => Promise<void>;

  // Security
  verifyNoteLock: (id: string, password: string) => Promise<string>; // Returns decrypted content
  
  // Auth
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string | null) => void;
}

const processLocalNote = (note: Note): Note => ({
  ...note,
});

const tryDecryptString = (value: unknown): any => {
  if (typeof value !== 'string') return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
};

const processApiNote = (note: Note): Note => ({
  ...note,
  title: decrypt(note.title),
  content: decrypt(note.content),
  tags: Array.isArray((note as any).tags) ? ((note as any).tags as any[]).map((t) => tryDecryptString(t)) : [],
  icon: (note as any).icon ? tryDecryptString((note as any).icon) : (note as any).icon,
  type: (note as any).type ? tryDecryptString((note as any).type) : (note as any).type,
});

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

const processApiTask = (task: any): Task => ({
  ...(task as Task),
  title: decrypt(task.title),
  description: decrypt(task.description),
  completed: parseTaskCompleted(task.completed),
  priority: parseTaskPriority(task.priority),
  dueDate: task.dueDate ? (typeof task.dueDate === 'string' ? decrypt(task.dueDate) : task.dueDate) : null,
});

const processLocalTask = (task: Task): Task => ({
  ...task,
  dueDate: task.dueDate ?? null,
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
  viewMode: 'list',
  isOffline: false,
  isSyncingOffline: false,
  activeProjectId: null,
  token: null,
  isInitialized: false,

  setActiveProject: (id) => set({ activeProjectId: id }),
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
  setViewMode: (mode) => set({ viewMode: mode }),

  init: async () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    await initApiUrl();
    await Database.initDatabase();

    const storedToken = await SecureStore.getItemAsync('token');
    if (storedToken) {
      setAuthToken(storedToken);
      set({ token: storedToken });
    }

    setUnauthorizedHandler(async () => {
      await get().logout();
    });
    
    // Load local data immediately
    const localNotes = await Database.getNotesLocal();
    const localTasks = await Database.getTasksLocal();
    set({ 
      notes: localNotes.map(processLocalNote), 
      tasks: localTasks.map(processLocalTask) 
    });

    // Setup network listener
    NetInfo.addEventListener(state => {
      const isOffline = !state.isConnected;
      set({ isOffline });
      if (!isOffline) {
        get().syncOfflineChanges();
      }
    });

    get().connectSocket();
  },

  connectSocket: () => {
    const token = get().token;
    const socket = initSocket(token);

    if (!socket) return;

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
      const parsed = processApiNote(note);
      set(state => {
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
      const parsed = processApiNote(note);
      set(state => {
        Database.saveNoteLocal(parsed, true);
        return {
          notes: state.notes.map(n => n._id === parsed._id ? parsed : n)
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

    socket.on('notes:reordered', (reorderedNotes: { _id: string; order: number }[]) => {
      set(state => {
        const newNotes = state.notes.map(n => {
          const update = reorderedNotes.find(rn => rn._id === n._id);
          if (update) {
            const updated = { ...n, order: update.order } as any;
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

    socket.on('tasks:reordered', (reorderedTasks: { _id: string; position: number }[]) => {
      set(state => {
        const newTasks = state.tasks.map(t => {
          const update = reorderedTasks.find(rt => rt._id === t._id);
          if (update) {
            const updated = { ...t, position: update.position };
            Database.saveTaskLocal(updated, true);
            return updated;
          }
          return t;
        });
        return { tasks: newTasks };
      });
    });
  },

  login: async (username, password) => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiLogin(username, password);
      setAuthToken(response.token);
      await SecureStore.setItemAsync('token', response.token);
      get().setToken(response.token);
      await get().init();
    } catch (error: any) {
      set({ error: error.message || 'Login failed' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (username, password) => {
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
    set({ token: null, notes: [], tasks: [], activeProjectId: null, error: null });
  },

  fetchNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const netState = await NetInfo.fetch();
      
      if (netState.isConnected) {
        const notes = await fetchWithAuth('/notes');
        const decryptedNotes = notes.map(processApiNote);
        
        // Update local DB
        for (const note of decryptedNotes) {
          await Database.saveNoteLocal(note, true);
        }
        set({ notes: decryptedNotes, isLoading: false });
      } else {
        // Already loaded from init, but refresh just in case
        const localNotes = await Database.getNotesLocal();
        set({ notes: localNotes.map(processLocalNote), isLoading: false });
      }
    } catch (error: any) {
      console.error('[Store] Fetch notes error:', error);
      // Fallback to local
      const localNotes = await Database.getNotesLocal();
      set({ notes: localNotes.map(processLocalNote), isLoading: false, error: error.message });
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
      password: data.password,
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
        type: data.type || 'note',
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
          const realNote = processApiNote(created);
          
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
        ...data,
        updatedAt: new Date().toISOString()
    };

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
      if (data.title) encryptedData.title = encrypt(data.title);
      if (data.content) encryptedData.content = encrypt(data.content);
      if (data.tags) encryptedData.tags = data.tags.map((t: string) => encrypt(t));
      if (data.icon) encryptedData.icon = encrypt(data.icon);

      // 5. Try Sync
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const updated = await fetchWithAuth(`/notes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(encryptedData),
          });
          const realNote = processApiNote(updated);
          
          // Update State & DB
          set(state => ({
              notes: state.notes.map(n => n._id === id ? realNote : n)
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
      const payload = notes.map((n, index) => ({ _id: n._id, order: index, parentId: n.parentId }));
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
    set({ isLoading: true, error: null });
    try {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        const url = parentNoteId ? `/tasks?parentNoteId=${encodeURIComponent(parentNoteId)}` : '/tasks';
        const tasks = await fetchWithAuth(url);
        const decryptedTasks = tasks.map(processApiTask);
        for (const task of decryptedTasks) {
          await Database.saveTaskLocal(task, true);
        }
        
        // Merge with local-only tasks (deduplicated by clientId if possible)
        const state = get();
        const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
        const localOnlyTasks = state.tasks.filter(t => t._id.startsWith('local_task_') && !serverClientIds.has(t.clientId));
        
        set({ tasks: [...decryptedTasks, ...localOnlyTasks], isLoading: false });
      } else {
        const localTasks = await Database.getTasksLocal();
        const filtered = parentNoteId ? localTasks.filter(t => t.parentNoteId === parentNoteId) : localTasks;
        set({ tasks: filtered.map(processLocalTask), isLoading: false });
      }
    } catch (error: any) {
      const localTasks = await Database.getTasksLocal();
      const filtered = parentNoteId ? localTasks.filter(t => t.parentNoteId === parentNoteId) : localTasks;
      set({ tasks: filtered.map(processLocalTask), isLoading: false, error: error.message });
    }
  },

  createTask: async (data) => {
    // Optimistic Update Pattern
    set({ isLoading: true, error: null });
    const clientId = Crypto.randomUUID();
    const tempId = `local_task_${Date.now()}`;
    
    // 1. Prepare optimistic task
    const optimisticTask: Task = {
      _id: tempId,
      userId: 'me', // Placeholder, will be replaced by backend or ignored locally
      title: data.title,
      description: data.description || '',
      dueDate: data.dueDate ?? null,
      completed: data.completed || false,
      priority: data.priority || 'medium',
      parentNoteId: data.parentNoteId ?? null,
      parentId: data.parentId ?? null,
      position: data.position ?? 0,
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

      // 4. Encrypt for Sync/Queue
      const encryptedData = {
        ...data,
        title: encrypt(data.title),
        description: data.description ? encrypt(data.description) : '',
        completed: encrypt(String(data.completed || false)),
        priority: encrypt(data.priority || 'medium'),
        dueDate: data.dueDate ? encrypt(new Date(data.dueDate).toISOString()) : '',
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

    const optimisticTask = {
      ...currentTask,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    // 2. Update State immediately
    set((state) => ({
      tasks: state.tasks.map((t) => (t._id === id ? optimisticTask : t)),
      isLoading: false,
    }));

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
    const payload: { _id: string; position: number }[] = [];

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
        payload.push({ _id: id, position: i });
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
                  const decryptedCreated = processApiNote(created);
                  
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
          if (status === 401) return;
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
            await Database.removeFromSyncQueue(item.id);
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
      });
      
      // response.content is the encrypted content from the server
      return decrypt(response.content);
    } catch (error: any) {
      throw error;
    }
  },
}));
