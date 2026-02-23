import { create } from 'zustand';
import { Note, Task, UpdateTaskDto, User, decrypt, encrypt } from '@repo/shared';
import { api, getUUID } from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import { db } from '../services/db';
import deepmerge from 'deepmerge';
import { uniqBy } from 'lodash';

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
  autoLockTimeout: number; // in minutes
  setAutoLockTimeout: (minutes: number) => void;
  
  fetchNotes: () => Promise<void>;
  fetchTasks: (parentNoteId?: string) => Promise<void>;
  selectNote: (id: string | null) => void;
  createNote: (title: string, parentId?: string | null, type?: 'note' | 'task_list' | 'project', order?: number, icon?: string) => Promise<void>;
  updateNote: (id: string, title?: string, content?: string, locked?: boolean, password?: string, icon?: string, type?: string) => Promise<void>;
  moveNote: (id: string, parentId: string | null, order: number) => Promise<void>;
  unlockNote: (id: string, password: string) => Promise<boolean>;
  deleteNote: (id: string) => Promise<void>;
  
  createTask: (title: string, parentNoteId?: string, dueDate?: string | null, options?: { description?: string; priority?: 'low' | 'medium' | 'high' }) => Promise<void>;
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
        const selectedNoteId = localStorage.getItem('lastSelectedNoteId') || localStorage.getItem('selectedNoteId') || null;
        const selectedTaskListId = localStorage.getItem('lastSelectedTaskListId') || null;
        const activeProjectId = localStorage.getItem('activeProjectId') || null;
        const isAppLocked = localStorage.getItem('isAppLocked') === 'true';
        const autoLockTimeout = parseInt(localStorage.getItem('autoLockTimeout') || '15', 10);

        set({ user, token, language, activeTab, selectedNoteId, selectedTaskListId, activeProjectId, isAppLocked, autoLockTimeout, isHydrated: true });
        if (token) {
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
        set({ user, token });
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
        set({ user, token });
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
    disconnectSocket();
    set({ user: null, token: null, notes: [], tasks: [], selectedNoteId: null, selectedTaskListId: null, isAppLocked: false });
  },

  notes: [],
  tasks: [],
  pendingCreated: { notes: {}, tasks: {} },
  selectedNoteId: null,
  selectedTaskListId: null,
  isLoading: false,
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
  autoLockTimeout: 15,

  setAppLocked: (locked) => {
    if (typeof window !== 'undefined') {
        if (locked) localStorage.setItem('isAppLocked', 'true');
        else localStorage.removeItem('isAppLocked');
    }
    set({ isAppLocked: locked });
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
      const decryptedNote = {
          ...newNote,
          title: decrypt(newNote.title),
          content: decrypt(newNote.content),
      };
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
      set(state => ({ notes: uniqBy([decryptedNote, ...state.notes], '_id') }));
      db.saveNote(decryptedNote);
    });

    socket.off('note:updated');
    socket.on('note:updated', (updatedNote: Note) => {
        const decryptedNote = {
            ...updatedNote,
            title: decrypt(updatedNote.title),
            content: decrypt(updatedNote.content),
        };
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
            const newNotes = state.notes.map(n => n._id === decryptedNote._id ? { ...n, ...decryptedNote } : n);
            
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
    socket.on('notes:reordered', (notes: Array<{ _id: string; order: number }>) => {
      set(state => {
        const orderMap = new Map(notes.map(n => [n._id, n.order]));
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
            position: parseInt(decrypt(newTask.position), 10)
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
            position: parseInt(decrypt(updatedTask.position), 10)
        };
        set(state => ({
            tasks: state.tasks.map(t => t._id === decryptedTask._id ? decryptedTask : t)
        }));
        db.saveTask(decryptedTask);
    });

    socket.off('task:deleted');
    socket.on('task:deleted', (taskId: string) => {
        set(state => ({
            tasks: state.tasks.filter(t => t._id !== taskId)
        }));
        db.deleteTask(taskId);
    });

    socket.off('tasks:reordered');
    socket.on('tasks:reordered', (reorderedTasks: { _id: string; position: number }[]) => {
        set(state => {
            const newTasks = state.tasks.map(t => {
                const update = reorderedTasks.find(rt => rt._id === t._id);
                if (update) {
                    return { ...t, position: update.position };
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
                      parentId: note.parentId 
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
                      locked: note.locked,
                      password: noteWithPassword.password,
                      icon: note.icon
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
                      clientId: task.clientId
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
                      dueDate: task.dueDate
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
    set({ isLoading: true, error: null });
    try {
        const cachedNotes = await db.getAllNotes();
        const validNotes = cachedNotes.filter(n => !(n as any).deleted);
        if (validNotes.length > 0) {
            set({ notes: validNotes, isLoading: false });
        }
    } catch (e) {
        console.error('Failed to load notes from DB', e);
    }

    try {
      const notes = await api.fetchNotes();
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

      set({ notes: uniqBy(mergedNotes, '_id'), isLoading: false });
      for (const note of notes) {
          await db.saveNote(note);
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchTasks: async (parentNoteId) => {
    set({ isLoading: true, error: null });
    try {
        const cachedTasks = await db.getAllTasks();
        const validTasks = cachedTasks.filter(t => !(t as any).deleted);
        if (validTasks.length > 0) {
             set({ tasks: validTasks, isLoading: false });
        }
    } catch (e) {
        console.error('Failed to load tasks from DB', e);
    }

    try {
        const tasks = await api.fetchTasks(parentNoteId);
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
        for (const task of tasks) {
            await db.saveTask(task);
        }
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

  updateNote: async (id, title, content, locked, password, icon, type) => {
    // Optimistic update
    set((state) => ({
      notes: state.notes.map((n) => {
        if (n._id === id) {
            return {
                ...n,
                ...(title !== undefined ? { title } : {}),
                ...(content !== undefined ? { content } : {}),
                ...(locked !== undefined ? { locked } : {}),
                ...(password !== undefined ? { password } : {}),
                ...(icon !== undefined ? { icon } : {}),
                ...(type !== undefined ? { type: type as any } : {}),
                updatedAt: encrypt(new Date().toISOString()) // Encrypt timestamp
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
      const payload: any = {};
      if (title !== undefined) payload.title = title;
      if (content !== undefined) payload.content = content;
      if (locked !== undefined) payload.locked = locked;
      if (password !== undefined) payload.password = password;
      if (icon !== undefined) payload.icon = icon;
      if (type !== undefined) payload.type = type;
      payload.updatedAt = encrypt(new Date().toISOString()); // Encrypt timestamp

      const updatedNote = await api.updateNote(id, payload);
      set((state) => ({
        notes: state.notes.map((n) => (n._id === id ? updatedNote : n))
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
      const { success, content } = await api.verifyLock(id, password);
      if (success) {
        set((state) => ({
          notes: state.notes.map((n) => (n._id === id ? { ...n, content } : n)) 
        }));
        // Update local DB with unlocked content?
        // Maybe unsafe to store unlocked content permanently if it's supposed to be locked?
        // But for offline access, we might need it.
        // Let's NOT store unlocked content in DB for security, or store it encrypted?
        // The DB stores what we have. If we have the content, we store it.
        // Ideally, we should encrypt before storing in IndexedDB too, using a local key?
        // For now, let's assume the user accepts the risk or we just don't persist unlocked state?
        // Actually, if we update the note in store, we might trigger a save?
        // No, updateNote triggers save. unlockNote just updates state.
        // So we don't persist unlocked content to IDB here automatically.
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

  createTask: async (title, parentNoteId, dueDate) => {
      const clientId = getUUID();
      try {
          const newTask = await api.createTask({ title, parentNoteId, priority: 'medium', clientId, dueDate: dueDate || null });
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
      } catch (error: any) {
          // Offline creation
          const tempId = `temp-${Date.now()}`;
          const tempTask = {
              _id: tempId,
              userId: 'local',
              clientId,
              title,
              description: '',
              dueDate: dueDate || null,
              parentNoteId,
              completed: false,
              priority: 'medium',
              position: 0,
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
      }
  },

  updateTask: async (id, data) => {
      // Optimistic
      set(state => ({
          tasks: state.tasks.map(t => t._id === id ? { ...t, ...data, updatedAt: new Date().toISOString() } : t)
      }));
      
      const currentTask = get().tasks.find(t => t._id === id);
      if (currentTask) {
          await db.saveTask(currentTask, true); // Mark pending sync
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
  setSortOrder: (order) => set({ sortOrder: order }),
}));
