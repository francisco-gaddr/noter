import { Note, CreateNoteDto, UpdateNoteDto, Task, CreateTaskDto, UpdateTaskDto, encrypt, decrypt, AuthResponse } from '@repo/shared';
import { getWebAuthTokenSync, getWebRefreshTokenSync, setWebAuthToken, setWebRefreshToken } from './authStorage';

type SessionAuthResponse = AuthResponse & { refreshToken?: string };
type ResponseLike = Pick<Response, 'ok' | 'status' | 'json' | 'text'>;

export const getUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Prefer a cryptographically strong fallback when available.
  const getRandomByte = (() => {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function') {
      const buffer = new Uint8Array(1);
      return () => {
        (crypto as any).getRandomValues(buffer);
        return buffer[0];
      };
    }
    return () => Math.floor(Math.random() * 256);
  })();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = getRandomByte() & 0x0f;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const API_URL_KEY = 'apiBaseUrl';
let apiTokenCache: string | null = null;
let refreshTokenCache: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let authTokenListener: null | ((token: string | null) => void) = null;

const shouldUseCookieSession = () => {
  if (typeof window === 'undefined') return false;
  return !(window as any)?.mlc?.isElectron;
};

const normalizeUrl = (value: string) => {
  const raw = value.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
  if (!raw) return '/api';
  if (raw.startsWith('/')) {
    let next = raw.replace(/\/+$/, '');
    if (/\/app\/api$/i.test(next)) {
      next = next.replace(/\/app\/api$/i, '/api');
    } else if (/\/app$/i.test(next)) {
      next = next.replace(/\/app$/i, '/api');
    } else if (!/\/api$/i.test(next)) {
      next = `${next.replace(/\/$/, '')}/api`;
    }
    return next;
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    let normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (/\/app\/api$/i.test(normalizedPath)) {
      normalizedPath = normalizedPath.replace(/\/app\/api$/i, '/api');
    } else if (/\/app$/i.test(normalizedPath)) {
      normalizedPath = normalizedPath.replace(/\/app$/i, '/api');
    } else if (!/\/api$/i.test(normalizedPath)) {
      normalizedPath = `${normalizedPath || ''}/api`;
    }
    const finalPath = normalizedPath.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${finalPath || '/api'}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
};

const getStorage = () => {
  if (typeof globalThis === 'undefined') return null;
  const storage = (globalThis as any).localStorage;
  return storage || null;
};

const getBaseUrl = () => {
  if (typeof window === 'undefined' && !getStorage()) {
    return normalizeUrl(process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '/api');
  }

  const storage = getStorage();
  const stored = storage ? storage.getItem(API_URL_KEY) : null;
  if (stored) {
    return normalizeUrl(stored);
  }

  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    if (envUrl && /^https?:\/\//i.test(envUrl)) return normalizeUrl(envUrl);
    return '/api';
  }
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
  const electronBridge = typeof window !== 'undefined' ? (window as any).mlc : undefined;
  if (electronBridge?.isElectron) {
    if (typeof electronBridge.setManySettings === 'function') {
      Promise.resolve(electronBridge.setManySettings({
        apiBaseUrl: trimmed,
        apiUrl: trimmed,
        backendUrl: trimmed,
      })).catch(() => {});
      return;
    }
    if (typeof electronBridge.setSetting === 'function') {
      Promise.all([
        electronBridge.setSetting('apiBaseUrl', trimmed),
        electronBridge.setSetting('apiUrl', trimmed),
        electronBridge.setSetting('backendUrl', trimmed),
      ]).catch(() => {});
    }
  }
};

export const setApiToken = (token: string | null) => {
  apiTokenCache = token;
  setWebAuthToken(token);
};

export const setApiAuthTokenListener = (listener: null | ((token: string | null) => void)) => {
  authTokenListener = listener;
};

export const setApiRefreshToken = (token: string | null) => {
  refreshTokenCache = token;
  setWebRefreshToken(token);
};

const applyAuthResponse = (data: Partial<SessionAuthResponse>) => {
  if (typeof data.token === 'string') {
    apiTokenCache = data.token;
    setWebAuthToken(data.token);
    authTokenListener?.(data.token);
  }
  if (typeof data.refreshToken === 'string') {
    refreshTokenCache = data.refreshToken;
    setWebRefreshToken(data.refreshToken);
  }
};

const clearSession = () => {
  apiTokenCache = null;
  refreshTokenCache = null;
  setWebAuthToken(null);
  setWebRefreshToken(null);
  authTokenListener?.(null);
};

const getHeaders = () => {
  const token = apiTokenCache || getWebAuthTokenSync();
  return {
    'Content-Type': 'application/json',
    ...((token && !shouldUseCookieSession()) ? { 'Authorization': `Bearer ${token}` } : {}),
  };
};

const getElectronBridge = () => {
  if (typeof window === 'undefined') return undefined;
  return (window as any).mlc;
};

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeRequestHeaders = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) return {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[String(key)] = String(value);
      return acc;
    }, {});
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (Array.isArray(value)) {
      acc[key] = value.map((item) => String(item)).join(', ');
    } else if (value !== undefined) {
      acc[key] = String(value);
    }
    return acc;
  }, {});
};

const createResponseLike = (payload: { ok: boolean; status: number; bodyText?: string }): ResponseLike => {
  const bodyText = typeof payload.bodyText === 'string' ? payload.bodyText : '';
  return {
    ok: payload.ok,
    status: payload.status,
    json: async () => bodyText ? JSON.parse(bodyText) : {},
    text: async () => bodyText,
  };
};

const fetchWithBridge = async (url: string, init: RequestInit = {}): Promise<ResponseLike> => {
  const bridge = getElectronBridge();
  if (bridge?.isElectron && typeof bridge.httpRequest === 'function' && isAbsoluteHttpUrl(url)) {
    try {
      const response = await bridge.httpRequest({
        url,
        method: init.method || 'GET',
        headers: normalizeRequestHeaders(init.headers),
        ...(typeof init.body === 'string' ? { body: init.body } : {}),
      });
      return createResponseLike(response);
    } catch (error) {
      const err: any = new Error(`Kunde inte nå API på ${url}`);
      err.cause = error;
      throw err;
    }
  }
  return fetch(url, init);
};

const refreshSession = async (): Promise<string | null> => {
  const refreshToken = refreshTokenCache || getWebRefreshTokenSync();
  if (!shouldUseCookieSession() && !refreshToken) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetchWithBridge(`${getBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...(refreshToken ? { body: JSON.stringify({ refreshToken }) } : {}),
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data: SessionAuthResponse = await res.json();
    applyAuthResponse(data);
    return data.token || null;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
};

const authedFetch = async (url: string, init: RequestInit = {}, allowRefresh = true): Promise<ResponseLike> => {
  const response = await fetchWithBridge(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...getHeaders(),
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (response.status === 401 && allowRefresh) {
    const refreshedToken = await refreshSession();
    if (refreshedToken) {
      return fetchWithBridge(url, {
        ...init,
        credentials: 'include',
        headers: {
          ...getHeaders(),
          ...((init.headers as Record<string, string>) || {}),
        },
      });
    }
  }
  return response;
};

const handleResponse = async (res: ResponseLike) => {
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

const ensureArrayPayload = (value: unknown): any[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && (value as any).offline === true) {
    return [];
  }
  return [];
};

const decryptOrRawString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    const decrypted = decrypt(value);
    if (typeof decrypted === 'string' && decrypted.length === 0 && value.trim().length > 0) {
      return value;
    }
    return decrypted;
  } catch {
    return value;
  }
};

const decryptStringValue = (value: unknown, fallback = ''): string => {
  const resolved = decryptOrRawString(value);
  return typeof resolved === 'string' ? resolved : fallback;
};

const parseTaskCompleted = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return decryptStringValue(value) === 'true';
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
    return normalize(decryptStringValue(value, 'medium'));
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

export const api = {
  // Auth
  async register(username: string, password: string): Promise<AuthResponse> {
    const res = await fetchWithBridge(`${getBaseUrl()}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await handleResponse(res);
    applyAuthResponse(data);
    return data;
  },

  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await fetchWithBridge(`${getBaseUrl()}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await handleResponse(res);
    applyAuthResponse(data);
    return data;
  },

  async logout(): Promise<void> {
    const currentRefreshToken = refreshTokenCache || getWebRefreshTokenSync();
    try {
      await fetchWithBridge(`${getBaseUrl()}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...(currentRefreshToken ? { body: JSON.stringify({ refreshToken: currentRefreshToken }) } : {}),
      });
    } finally {
      clearSession();
    }
  },

  async restoreSession(): Promise<AuthResponse | null> {
    const token = apiTokenCache || getWebAuthTokenSync();
    if (!token && !shouldUseCookieSession()) {
      return null;
    }
    const refreshedToken = token || await refreshSession();
    if (!refreshedToken) return null;
    const me = await authedFetch(`${getBaseUrl()}/auth/me`, {}, false);
    if (!me.ok) {
      clearSession();
      return null;
    }
    const user = await handleResponse(me);
    return {
      user,
      token: refreshedToken,
      ...(refreshTokenCache ? { refreshToken: refreshTokenCache } : {}),
    };
  },

  // Notes
  async fetchNotes(): Promise<any[]> {
    const res = await authedFetch(`${getBaseUrl()}/notes`);
    return ensureArrayPayload(await handleResponse(res));
  },

  async decryptNotes(encryptedNotes: any[]): Promise<Note[]> {
    const CHUNK_SIZE = 50;
    const result: Note[] = [];
    
    // Process in chunks to avoid blocking the event loop
    for (let i = 0; i < encryptedNotes.length; i += CHUNK_SIZE) {
        const chunk = encryptedNotes.slice(i, i + CHUNK_SIZE);
        
        // Use a small delay to let the UI breathe if the list is huge
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));
        
        const decryptedChunk = chunk.map(note => {
            const locked = parseNoteLocked(note.locked);
            return {
                ...note,
                title: locked ? 'Låst anteckning' : decryptStringValue(note.title),
                content: locked ? '' : decryptStringValue(note.content),
                tags: locked ? [] : (note.tags?.map((t: string) => decryptStringValue(t, t)) ?? []),
                icon: locked ? undefined : (note.icon ? decryptStringValue(note.icon, note.icon) : undefined),
                type: note.type ? (decryptStringValue(note.type, String(note.type)) as any) : 'note',
                locked: locked,
                order: parseNoteOrder((note as any).order),
                createdAt: decrypt(note.createdAt),
                updatedAt: decrypt(note.updatedAt),
            };
        });
        result.push(...decryptedChunk);
    }
    return result;
  },

  async getNote(id: string): Promise<Note> {
    const res = await authedFetch(`${getBaseUrl()}/notes/${id}`);
    const note: Note = await handleResponse(res);
    const locked = parseNoteLocked(note.locked);
    return {
        ...note,
        title: locked ? 'Låst anteckning' : decryptStringValue(note.title),
        content: locked ? '' : decryptStringValue(note.content),
        tags: locked ? [] : (note.tags?.map(t => decryptStringValue(t, String(t))) ?? []),
        icon: locked ? undefined : (note.icon ? decryptStringValue(note.icon, note.icon) : undefined),
        type: note.type ? (decryptStringValue(note.type, String(note.type)) as any) : 'note',
        locked: locked,
        order: parseNoteOrder((note as any).order),
        createdAt: decrypt(note.createdAt),
        updatedAt: decrypt(note.updatedAt),
    };
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
      order: data.order !== undefined ? encrypt(String(data.order)) : undefined,
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    };
    
    const res = await authedFetch(`${getBaseUrl()}/notes`, {
      method: 'POST',
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    const locked = note.locked ? decrypt(String(note.locked)) === 'true' : false;
    return {
      ...note,
      title: locked ? 'Låst anteckning' : decryptStringValue(note.title),
      content: locked ? '' : decryptStringValue(note.content),
      tags: locked ? [] : (note.tags?.map(t => decryptStringValue(t, String(t))) ?? []),
      icon: locked ? undefined : (note.icon ? decryptStringValue(note.icon, note.icon) : undefined),
      type: note.type ? (decryptStringValue(note.type, String(note.type)) as any) : 'note',
      locked,
      order: parseNoteOrder((note as any).order),
      createdAt: decrypt(note.createdAt),
      updatedAt: decrypt(note.updatedAt),
    };
  },

  async updateNote(id: string, data: UpdateNoteDto): Promise<Note> {
    const encryptedData = { ...data } as any;
    if (data.title !== undefined) encryptedData.title = encrypt(data.title);
    if (data.content !== undefined) encryptedData.content = encrypt(data.content);
    if (data.tags !== undefined) encryptedData.tags = data.tags.map((t) => encrypt(t));
    if (data.icon !== undefined) encryptedData.icon = data.icon ? encrypt(data.icon) : undefined;
    if (data.type !== undefined) encryptedData.type = encrypt(String(data.type)) as any;
    if (data.locked !== undefined) encryptedData.locked = encrypt(String(data.locked));
    if (data.order !== undefined) encryptedData.order = encrypt(String(data.order));
    if (data.password !== undefined) encryptedData.password = data.password;
    // Always update updatedAt
    encryptedData.updatedAt = encrypt(new Date().toISOString());

    const res = await authedFetch(`${getBaseUrl()}/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return {
      ...note,
      title: decryptStringValue(note.title),
      content: decryptStringValue(note.content),
      tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
      icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
      type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
      locked: note.locked ? decrypt(String(note.locked)) === 'true' : false,
      order: parseNoteOrder((note as any).order),
      createdAt: decrypt(note.createdAt),
      updatedAt: decrypt(note.updatedAt),
    };
  },

  async verifyLock(id: string, password: string): Promise<{ success: boolean; content: string; title?: string; unlockedId?: string }> {
    const res = await authedFetch(`${getBaseUrl()}/notes/${id}/verify-lock`, {
      method: 'POST',
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
      content: decryptStringValue(data.content),
      title: data.title ? decryptStringValue(data.title) : undefined,
      unlockedId: typeof data.unlockedId === 'string' ? data.unlockedId : undefined,
    };
  },

  async deleteNote(id: string): Promise<void> {
    const res = await authedFetch(`${getBaseUrl()}/notes/${id}`, {
      method: 'DELETE',
    });
    await handleResponse(res);
  },

  // Tasks
  async fetchTasks(parentNoteId?: string): Promise<any[]> {
    const url = parentNoteId ? `${getBaseUrl()}/tasks?parentNoteId=${parentNoteId}` : `${getBaseUrl()}/tasks`;
    const res = await authedFetch(url);
    return ensureArrayPayload(await handleResponse(res));
  },

  async decryptTasks(encryptedTasks: any[]): Promise<Task[]> {
    const CHUNK_SIZE = 50;
    const result: Task[] = [];

    for (let i = 0; i < encryptedTasks.length; i += CHUNK_SIZE) {
        const chunk = encryptedTasks.slice(i, i + CHUNK_SIZE);
        
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));

        const decryptedChunk = chunk.map(task => ({
            ...task,
            title: decryptStringValue(task.title),
            description: decryptStringValue(task.description),
            completed: parseTaskCompleted(task.completed),
            priority: parseTaskPriority(task.priority),
            dueDate: task.dueDate ? (() => {
                try {
                const decrypted = decrypt(task.dueDate);
                const date = new Date(decrypted);
                return isNaN(date.getTime()) ? null : date;
                } catch {
                return null;
                }
            })() : null,
            recurrenceType: task.recurrenceType ? (() => {
                try {
                return decrypt(task.recurrenceType) as any;
                } catch {
                return 'none' as any;
                }
            })() : 'none',
            recurrenceDays: task.recurrenceDays ? (() => {
                try {
                return JSON.parse(decrypt(task.recurrenceDays));
                } catch {
                return [];
                }
            })() : [],
            reminderEnabled: task.reminderEnabled ? (() => {
                try {
                return decrypt(task.reminderEnabled) === 'true';
                } catch {
                return false;
                }
            })() : false,
            reminderOffsetMinutes: parseReminderOffsets(task.reminderOffsetMinutes),
            createdAt: decrypt(task.createdAt),
            updatedAt: decrypt(task.updatedAt),
            position: task.position ? (() => {
                try {
                const decrypted = decrypt(String(task.position));
                const num = Number(decrypted);
                return isNaN(num) ? 0 : num;
                } catch {
                return 0;
                }
            })() : 0,
        }));
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
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      position: data.position !== undefined ? encrypt(String(data.position)) : encrypt('0'),
    };
    
    const res = await authedFetch(`${getBaseUrl()}/tasks`, {
      method: 'POST',
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return {
      ...task,
      title: decryptStringValue(task.title),
      description: decryptStringValue(task.description),
      completed: parseTaskCompleted(task.completed),
      priority: parseTaskPriority(task.priority),
      dueDate: task.dueDate ? (() => {
        try {
          const decrypted = decrypt(task.dueDate);
          const date = new Date(decrypted);
          return isNaN(date.getTime()) ? null : date;
        } catch {
          return null;
        }
      })() : null,
      recurrenceType: task.recurrenceType ? (() => {
        try {
          return decrypt(task.recurrenceType) as any;
        } catch {
          return 'none' as any;
        }
      })() : 'none',
      recurrenceDays: task.recurrenceDays ? (() => {
        try {
          return JSON.parse(decrypt(task.recurrenceDays));
        } catch {
          return [];
        }
      })() : [],
      reminderEnabled: task.reminderEnabled ? (() => {
        try {
          return decrypt(task.reminderEnabled) === 'true';
        } catch {
          return false;
        }
      })() : false,
      reminderOffsetMinutes: parseReminderOffsets(task.reminderOffsetMinutes),
      createdAt: decrypt(task.createdAt),
      updatedAt: decrypt(task.updatedAt),
      position: task.position ? (() => {
        try {
          const decrypted = decrypt(String(task.position));
          const num = Number(decrypted);
          return isNaN(num) ? 0 : num;
        } catch {
          return 0;
        }
      })() : 0,
    };
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
    encryptedData.updatedAt = encrypt(new Date().toISOString());
    if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));

    const res = await authedFetch(`${getBaseUrl()}/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return {
      ...task,
      title: decryptStringValue(task.title),
      description: decryptStringValue(task.description),
      completed: parseTaskCompleted(task.completed),
      priority: parseTaskPriority(task.priority),
      dueDate: task.dueDate ? (() => {
        try {
          const decrypted = decrypt(task.dueDate);
          const date = new Date(decrypted);
          return isNaN(date.getTime()) ? null : date;
        } catch {
          return null;
        }
      })() : null,
      recurrenceType: task.recurrenceType ? (() => {
        try {
          return decrypt(task.recurrenceType) as any;
        } catch {
          return 'none' as any;
        }
      })() : 'none',
      recurrenceDays: task.recurrenceDays ? (() => {
        try {
          return JSON.parse(decrypt(task.recurrenceDays));
        } catch {
          return [];
        }
      })() : [],
      reminderEnabled: task.reminderEnabled ? (() => {
        try {
          return decrypt(task.reminderEnabled) === 'true';
        } catch {
          return false;
        }
      })() : false,
      reminderOffsetMinutes: parseReminderOffsets(task.reminderOffsetMinutes),
      createdAt: decrypt(task.createdAt),
      updatedAt: decrypt(task.updatedAt),
      position: task.position ? (() => {
        try {
          const decrypted = decrypt(String(task.position));
          const num = Number(decrypted);
          return isNaN(num) ? 0 : num;
        } catch {
          return 0;
        }
      })() : 0,
    };
  },

  async deleteTask(id: string): Promise<void> {
    const res = await authedFetch(`${getBaseUrl()}/tasks/${id}`, {
      method: 'DELETE',
    });
    await handleResponse(res);
  },

  async reorderTasks(tasks: { _id: string; position: number }[]): Promise<void> {
    const encryptedTasks = tasks.map(task => ({
      _id: task._id,
      position: encrypt(String(task.position))
    }));
    const res = await authedFetch(`${getBaseUrl()}/tasks/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ tasks: encryptedTasks }),
    });
    await handleResponse(res);
  },
 
   async assignTasksToList(noteId: string): Promise<void> {
     const res = await authedFetch(`${getBaseUrl()}/tasks/assign-to-list`, {
       method: 'PUT',
       body: JSON.stringify({ noteId }),
     });
     await handleResponse(res);
   },
};
