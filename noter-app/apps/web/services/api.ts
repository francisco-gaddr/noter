import { Note, CreateNoteDto, UpdateNoteDto, Task, CreateTaskDto, UpdateTaskDto, encrypt, decrypt, safeDecrypt, AuthResponse, parseEntityLinks, serializeEntityLinks } from '@repo/shared';
import { readStoredToken, writeStoredToken } from '../lib/authStorage';

export const getUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const API_URL_KEY = 'apiBaseUrl';
let apiTokenCache: string | null = null;

const normalizeUrl = (value: string) => {
  let next = value.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().replace(/\/+$/, '');
  if (/\/app\/api$/i.test(next)) {
    next = next.replace(/\/app\/api$/i, '/api');
  } else if (/\/app$/i.test(next)) {
    next = next.replace(/\/app$/i, '/api');
  }
  return next;
};

const getStorage = () => {
  if (typeof globalThis === 'undefined') return null;
  const storage = (globalThis as any).localStorage;
  return storage || null;
};

const getBaseUrl = () => {
  if (typeof window === 'undefined' && !getStorage()) {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  }

  const storage = getStorage();
  const stored = storage ? storage.getItem(API_URL_KEY) : null;
  if (stored) {
    return normalizeUrl(stored);
  }

  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    if (envUrl && /^https?:\/\//i.test(envUrl)) return normalizeUrl(envUrl);
    return 'https://daylited.com/api';
  }
  // If envUrl is defined but contains localhost, and we are NOT on localhost, 
  // assume we should use relative path to allow Nginx to proxy correctly.
  if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) && 
      typeof window !== 'undefined' &&
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '/api';
  }
  return envUrl || '/api';
};

export const getApiBaseUrl = () => getBaseUrl();

export const setApiBaseUrl = (url: string) => {
  const storage = getStorage();
  if (!storage) return;
  const trimmed = normalizeUrl(url.trim());
  storage.setItem(API_URL_KEY, trimmed);
};

export const setApiToken = (token: string | null) => {
  apiTokenCache = token;
  // Persist the bearer token ENCRYPTED at rest (defeats generic localStorage scrapers);
  // apiTokenCache holds the raw value in memory for request headers.
  writeStoredToken(token);
};

const getHeaders = () => {
  const token = apiTokenCache || readStoredToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
};

const handleResponse = async (res: Response) => {
    if (res.status === 401) {
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err: any = new Error(data.message || 'Request failed');
        err.status = res.status;
        throw err;
    }
    return res.json();
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

const parseReminderOffsets = (value: unknown): number[] => {
  const normalizeOffsets = (raw: unknown): number[] => {
    if (Array.isArray(raw)) {
      const values = raw
        .map((item) => Number(item))
        .filter((item) => !Number.isNaN(item) && item >= 0);
      const unique = Array.from(new Set(values));
      return unique.length > 0 ? unique : [0];
    }
    if (typeof raw === 'number') {
      if (!Number.isNaN(raw) && raw >= 0) return [raw];
      return [0];
    }
    if (typeof raw === 'string') {
      const parsedNum = Number(raw);
      if (!Number.isNaN(parsedNum) && parsedNum >= 0) return [parsedNum];
      return [0];
    }
    return [0];
  };

  if (typeof value === 'string') {
    try {
      const decrypted = decrypt(value);
      try {
        return normalizeOffsets(JSON.parse(decrypted));
      } catch {
        return normalizeOffsets(decrypted);
      }
    } catch {
      try {
        return normalizeOffsets(JSON.parse(value));
      } catch {
        return normalizeOffsets(value);
      }
    }
  }
  return normalizeOffsets(value);
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

/**
 * Single source for decrypting a note from the API. Uses safeDecrypt so
 * plaintext/legacy/v3 values are never blanked (the "tomma poster" bug), and a
 * locked note is masked. Replaces four near-identical inline blocks.
 */
const decryptNoteFromApi = (note: any): Note => {
  const locked = parseNoteLocked(note.locked);
  return {
    ...note,
    title: locked ? 'Låst anteckning' : safeDecrypt(note.title, note.title),
    content: locked ? '' : safeDecrypt(note.content, note.content),
    tags: locked ? [] : (note.tags?.map((t: string) => safeDecrypt(t, t)) ?? []),
    icon: locked ? undefined : (note.icon ? safeDecrypt(note.icon, note.icon) : undefined),
    type: note.type ? (safeDecrypt(note.type, note.type) as any) : 'note',
    locked,
    links: locked ? [] : parseEntityLinks(note.links ? safeDecrypt(note.links, '') : ''),
    order: parseNoteOrder((note as any).order),
    createdAt: safeDecrypt(note.createdAt, note.createdAt),
    updatedAt: safeDecrypt(note.updatedAt, note.updatedAt),
  };
};

/** Single source for decrypting a task from the API (safeDecrypt — never blanks). */
const decryptTaskFromApi = (task: any): Task => ({
  ...task,
  title: safeDecrypt(task.title, task.title),
  description: safeDecrypt(task.description, task.description),
  completed: parseTaskCompleted(task.completed),
  priority: parseTaskPriority(task.priority),
  dueDate: task.dueDate
    ? (() => { const d = new Date(safeDecrypt(task.dueDate, task.dueDate)); return isNaN(d.getTime()) ? null : d; })()
    : null,
  recurrenceType: task.recurrenceType ? (safeDecrypt(task.recurrenceType, 'none') as any) : 'none',
  recurrenceDays: task.recurrenceDays
    ? (() => { try { return JSON.parse(safeDecrypt(task.recurrenceDays, '[]')); } catch { return []; } })()
    : [],
  reminderEnabled: task.reminderEnabled ? safeDecrypt(task.reminderEnabled) === 'true' : false,
  reminderOffsetMinutes: parseReminderOffsets(task.reminderOffsetMinutes),
  links: parseEntityLinks(task.links ? safeDecrypt(task.links, '') : ''),
  createdAt: safeDecrypt(task.createdAt, task.createdAt),
  updatedAt: safeDecrypt(task.updatedAt, task.updatedAt),
  position: task.position
    ? (() => { const n = Number(safeDecrypt(String(task.position), String(task.position))); return isNaN(n) ? 0 : n; })()
    : 0,
});

export const api = {
  // Auth
  async register(username: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${getBaseUrl()}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(res);
  },

  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${getBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(res);
  },

  // Notes
  async fetchNotes(): Promise<any[]> {
    const res = await fetch(`${getBaseUrl()}/notes`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async decryptNotes(encryptedNotes: any[]): Promise<Note[]> {
    const CHUNK_SIZE = 50;
    const result: Note[] = [];
    
    // Process in chunks to avoid blocking the event loop
    for (let i = 0; i < encryptedNotes.length; i += CHUNK_SIZE) {
        const chunk = encryptedNotes.slice(i, i + CHUNK_SIZE);
        
        // Use a small delay to let the UI breathe if the list is huge
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));
        
        const decryptedChunk = chunk.map(decryptNoteFromApi);
        result.push(...decryptedChunk);
    }
    return result;
  },

  async getNote(id: string): Promise<Note> {
    const res = await fetch(`${getBaseUrl()}/notes/${id}`, { headers: getHeaders() });
    const note: Note = await handleResponse(res);
    return decryptNoteFromApi(note);
  },

  async createNote(data: CreateNoteDto): Promise<Note> {
    const encryptedData = {
      ...data,
      title: encrypt(data.title),
      content: encrypt(data.content),
      tags: data.tags?.map(t => encrypt(t)) ?? [],
      icon: data.icon ? encrypt(data.icon) : undefined,
      type: encrypt(data.type || 'note'),
      locked: encrypt(String(data.locked || false)),
      links: data.links && data.links.length ? encrypt(serializeEntityLinks(data.links)) : undefined,
      order: data.order !== undefined ? encrypt(String(data.order)) : undefined,
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    };
    
    const res = await fetch(`${getBaseUrl()}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return decryptNoteFromApi(note);
  },

  async updateNote(id: string, data: UpdateNoteDto): Promise<Note> {
    const encryptedData = { ...data } as any;
    if (data.title !== undefined) encryptedData.title = encrypt(data.title);
    if (data.content !== undefined) encryptedData.content = encrypt(data.content);
    if (data.tags !== undefined) encryptedData.tags = data.tags.map((t) => encrypt(t));
    if (data.icon !== undefined) encryptedData.icon = data.icon ? encrypt(data.icon) : undefined;
    if (data.type !== undefined) encryptedData.type = encrypt(String(data.type)) as any;
    if (data.locked !== undefined) encryptedData.locked = encrypt(String(data.locked));
    if (data.links !== undefined) encryptedData.links = data.links && data.links.length ? encrypt(serializeEntityLinks(data.links)) : '';
    if (data.order !== undefined) encryptedData.order = encrypt(String(data.order));
    if (data.password !== undefined) encryptedData.password = data.password;
    // Always update updatedAt
    encryptedData.updatedAt = encrypt(new Date().toISOString());

    const res = await fetch(`${getBaseUrl()}/notes/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    // updateNote intentionally does NOT mask (you're editing the note); still
    // routed through safeDecrypt so values are never blanked.
    return {
      ...note,
      title: safeDecrypt(note.title, note.title),
      content: safeDecrypt(note.content, note.content),
      tags: note.tags?.map(t => safeDecrypt(t, t)) ?? [],
      icon: note.icon ? safeDecrypt(note.icon, note.icon) : undefined,
      type: note.type ? (safeDecrypt(note.type, note.type) as any) : 'note',
      locked: parseNoteLocked(note.locked),
      order: parseNoteOrder((note as any).order),
      createdAt: safeDecrypt(note.createdAt, note.createdAt),
      updatedAt: safeDecrypt(note.updatedAt, note.updatedAt),
    };
  },

  async verifyLock(id: string, password: string): Promise<{ success: boolean; content: string; title?: string; unlockedId?: string }> {
    const res = await fetch(`${getBaseUrl()}/notes/${id}/verify-lock`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    // Handle legacy 401 or new 200 success:false
    if (res.status === 401 || (res.ok && data.success === false)) {
         if (data.message === 'Invalid password' || (res.status === 401 && !data.success)) {
             return { success: false, content: '', title: '' }; 
         }
         if (res.status === 401) {
            throw new Error(data.message || 'Unauthorized');
         }
    }
    
    if (!res.ok) {
       throw new Error(data.message || 'Failed to verify lock');
    }
    
    return {
      success: true,
      content: safeDecrypt(data.content, data.content),
      title: data.title ? safeDecrypt(data.title, data.title) : undefined,
      unlockedId: typeof data.unlockedId === 'string' ? data.unlockedId : undefined,
    };
  },

  async deleteNote(id: string): Promise<void> {
    const res = await fetch(`${getBaseUrl()}/notes/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse(res);
  },

  // Tasks
  async fetchTasks(parentNoteId?: string): Promise<any[]> {
    const url = parentNoteId ? `${getBaseUrl()}/tasks?parentNoteId=${parentNoteId}` : `${getBaseUrl()}/tasks`;
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },

  async decryptTasks(encryptedTasks: any[]): Promise<Task[]> {
    const CHUNK_SIZE = 50;
    const result: Task[] = [];

    for (let i = 0; i < encryptedTasks.length; i += CHUNK_SIZE) {
        const chunk = encryptedTasks.slice(i, i + CHUNK_SIZE);
        
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));

        const decryptedChunk = chunk.map(decryptTaskFromApi);
        result.push(...decryptedChunk);
    }
    return result;
  },

  async createTask(data: CreateTaskDto): Promise<Task> {
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
      reminderOffsetMinutes: data.reminderOffsetMinutes !== undefined ? encrypt(JSON.stringify(data.reminderOffsetMinutes)) : '',
      links: data.links && data.links.length ? encrypt(serializeEntityLinks(data.links)) : '',
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      position: data.position !== undefined ? encrypt(String(data.position)) : encrypt('0'),
    };
    
    const res = await fetch(`${getBaseUrl()}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return decryptTaskFromApi(task);
  },

  async updateTask(id: string, data: UpdateTaskDto): Promise<Task> {
    const encryptedData = { ...data } as any;
    if (data.title !== undefined) encryptedData.title = encrypt(data.title);
    if (data.description !== undefined) encryptedData.description = encrypt(data.description || '');
    if (data.completed !== undefined) encryptedData.completed = encrypt(String(data.completed));
    if (data.priority !== undefined) encryptedData.priority = encrypt(data.priority);
    if (data.dueDate !== undefined) {
      encryptedData.dueDate = data.dueDate ? encrypt(new Date(data.dueDate).toISOString()) : '';
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
    if (data.reminderOffsetMinutes !== undefined) {
      encryptedData.reminderOffsetMinutes = encrypt(JSON.stringify(data.reminderOffsetMinutes));
    }
    if (data.links !== undefined) encryptedData.links = data.links && data.links.length ? encrypt(serializeEntityLinks(data.links)) : '';
    encryptedData.updatedAt = encrypt(new Date().toISOString());
    if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));

    const res = await fetch(`${getBaseUrl()}/tasks/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return decryptTaskFromApi(task);
  },

  async deleteTask(id: string): Promise<void> {
    const res = await fetch(`${getBaseUrl()}/tasks/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse(res);
  },

  async reorderTasks(tasks: { _id: string; position: number }[]): Promise<void> {
    const encryptedTasks = tasks.map(task => ({
      _id: task._id,
      position: encrypt(String(task.position))
    }));
    const res = await fetch(`${getBaseUrl()}/tasks/reorder`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ tasks: encryptedTasks }),
    });
    await handleResponse(res);
  },
 
   async assignTasksToList(noteId: string): Promise<void> {
     const res = await fetch(`${getBaseUrl()}/tasks/assign-to-list`, {
       method: 'PUT',
       headers: getHeaders(),
       body: JSON.stringify({ noteId }),
     });
     await handleResponse(res);
   },
};
