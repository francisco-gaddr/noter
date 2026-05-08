import {
  Note,
  CreateNoteDto,
  UpdateNoteDto,
  Task,
  CreateTaskDto,
  UpdateTaskDto,
  BulkSyncOperation,
  BulkSyncResult,
  encrypt,
  decrypt,
  decryptWithSource,
  isV3Ciphertext,
  AuthResponse,
  createPasswordWrappedEncryption,
} from '@repo/shared';
import { getWebAuthTokenSync, getWebRefreshTokenSync, setWebAuthToken, setWebRefreshToken } from './authStorage';
import { bootstrapWebEncryptionFromPassword, cacheWebDataKey, clearWebDataKey } from './encryptionKey';

type SessionAuthResponse = AuthResponse & { refreshToken?: string };
type ChangeSetPayload<T> = { items: T[]; deletedIds: string[]; serverTime: string };
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

const syncElectronSession = (payload: Partial<{ token: string | null; refreshToken: string | null }>) => {
  if (typeof window === 'undefined') return;
  const bridge = (window as any).mlc;
  if (!bridge?.isElectron || typeof bridge.setSession !== 'function') return;
  const nextPayload: Record<string, string | null> = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'token')) {
    nextPayload.token = payload.token ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'refreshToken')) {
    nextPayload.refreshToken = payload.refreshToken ?? null;
  }
  if (Object.keys(nextPayload).length === 0) return;
  Promise.resolve(bridge.setSession(nextPayload)).catch(() => {});
};

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

const getApiRootUrl = () => {
  const baseUrl = normalizeUrl(getBaseUrl());
  return baseUrl.replace(/\/api\/?$/i, '');
};

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
    syncElectronSession({ token: data.token });
  }
  if (typeof data.refreshToken === 'string') {
    refreshTokenCache = data.refreshToken;
    setWebRefreshToken(data.refreshToken);
    syncElectronSession({ refreshToken: data.refreshToken });
  }
};

const clearSession = () => {
  apiTokenCache = null;
  refreshTokenCache = null;
  setWebAuthToken(null);
  setWebRefreshToken(null);
  authTokenListener?.(null);
  syncElectronSession({ token: null, refreshToken: null });
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
        err.code = typeof data?.code === 'string' ? data.code : undefined;
        err.details = data;
        throw err;
    }
    return res.json();
};

const toChangeSetPayload = async <T,>(res: ResponseLike): Promise<ChangeSetPayload<T>> => {
  const payload = await handleResponse(res);
  if (Array.isArray(payload)) {
    return {
      items: ensureArrayPayload(payload) as T[],
      deletedIds: [],
      serverTime: new Date().toISOString(),
    };
  }
  return {
    items: ensureArrayPayload((payload as any)?.items) as T[],
    deletedIds: ensureArrayPayload((payload as any)?.deletedIds).map((item) => String(item)),
    serverTime: typeof (payload as any)?.serverTime === 'string'
      ? (payload as any).serverTime
      : new Date().toISOString(),
  };
};

export const probeBackendReachability = async (timeoutMs = 5000): Promise<boolean> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${getApiRootUrl()}/api/ready`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller?.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
  const raw: string = value;
  if (isV3Ciphertext(raw)) return '';
  const result = decryptWithSource(raw);
  return result.source === 'failed' ? '' : result.value;
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

const deserializeNote = (note: any): Note => {
  const locked = parseNoteLocked(note.locked);
  return {
    ...note,
    title: locked ? 'Låst anteckning' : decryptStringValue(note.title),
    content: locked ? '' : decryptStringValue(note.content),
    tags: locked ? [] : (note.tags?.map((t: string) => decryptStringValue(t, String(t))) ?? []),
    icon: locked ? undefined : (note.icon ? decryptStringValue(note.icon, note.icon) : undefined),
    type: note.type ? (decryptStringValue(note.type, String(note.type)) as any) : 'note',
    locked,
    order: parseNoteOrder((note as any).order),
    createdAt: decrypt(note.createdAt),
    updatedAt: decrypt(note.updatedAt),
  };
};

const deserializeTask = (task: any): Task => ({
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
});

const encryptNotePayload = (data: Partial<CreateNoteDto & UpdateNoteDto> & { createdAt?: string; updatedAt?: string }) => {
  const encryptedData = { ...data } as any;
  if (data.baseUpdatedAt !== undefined) encryptedData.baseUpdatedAt = data.baseUpdatedAt;
  if (data.clientMutationId !== undefined) encryptedData.clientMutationId = data.clientMutationId;
  if (data.title !== undefined) encryptedData.title = encrypt(data.title);
  if (data.content !== undefined) encryptedData.content = encrypt(data.content);
  if (data.tags !== undefined) encryptedData.tags = data.tags.map((t) => encrypt(t));
  if (data.icon !== undefined) encryptedData.icon = data.icon ? encrypt(data.icon) : undefined;
  if (data.type !== undefined) encryptedData.type = encrypt(String(data.type)) as any;
  if (data.locked !== undefined) encryptedData.locked = encrypt(String(data.locked));
  if (data.order !== undefined) encryptedData.order = encrypt(String(data.order));
  if ((data as any).password !== undefined) encryptedData.password = (data as any).password;
  if ((data as any).unlockPassword !== undefined) encryptedData.unlockPassword = (data as any).unlockPassword;
  return encryptedData;
};

const encryptTaskPayload = (data: Partial<CreateTaskDto & UpdateTaskDto> & { createdAt?: string; updatedAt?: string }) => {
  const encryptedData = { ...data } as any;
  if (data.baseUpdatedAt !== undefined) encryptedData.baseUpdatedAt = data.baseUpdatedAt;
  if (data.clientMutationId !== undefined) encryptedData.clientMutationId = data.clientMutationId;
  if (data.title !== undefined) encryptedData.title = encrypt(data.title);
  if (data.description !== undefined) encryptedData.description = encrypt(data.description || '');
  if (data.completed !== undefined) encryptedData.completed = encrypt(String(data.completed));
  if (data.priority !== undefined) encryptedData.priority = encrypt(data.priority);
  if (data.dueDate !== undefined) {
    encryptedData.dueDate = data.dueDate ? encrypt(new Date(data.dueDate).toISOString()) : '';
  }
  if ((data as any).createdAt !== undefined) encryptedData.createdAt = (data as any).createdAt;
  if ((data as any).updatedAt !== undefined) encryptedData.updatedAt = (data as any).updatedAt;
  if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));
  if ((data as any).parentNoteId !== undefined) encryptedData.parentNoteId = (data as any).parentNoteId;
  if ((data as any).clientId !== undefined) encryptedData.clientId = (data as any).clientId;
  if ((data as any).recurrenceType !== undefined) {
    encryptedData.recurrenceType = (data as any).recurrenceType ? encrypt((data as any).recurrenceType) : '';
  }
  if ((data as any).recurrenceDays !== undefined) {
    encryptedData.recurrenceDays = (data as any).recurrenceDays ? encrypt(JSON.stringify((data as any).recurrenceDays)) : '';
  }
  if ((data as any).reminderEnabled !== undefined) {
    encryptedData.reminderEnabled = encrypt(String((data as any).reminderEnabled));
  }
  if ((data as any).reminderOffsetMinutes !== undefined) {
    encryptedData.reminderOffsetMinutes = encrypt(JSON.stringify((data as any).reminderOffsetMinutes));
  }
  return encryptedData;
};

export const api = {
  // Auth
  async register(username: string, password: string): Promise<AuthResponse> {
    const encryption = createPasswordWrappedEncryption(password);
    const res = await fetchWithBridge(`${getBaseUrl()}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        wrappedDataKey: encryption.wrappedDataKey,
        encryptionSalt: encryption.salt,
        keyWrapVersion: encryption.keyWrapVersion,
        keyWrapKdf: encryption.keyWrapKdf,
      }),
    });
    const data = await handleResponse(res);
    await cacheWebDataKey(encryption.dataKey);
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
    await bootstrapWebEncryptionFromPassword(password, data.encryption);
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
      await clearWebDataKey().catch(() => {});
    }
  },

  async restoreSession(): Promise<AuthResponse | null> {
    const token = apiTokenCache || getWebAuthTokenSync();
    const refreshToken = refreshTokenCache || getWebRefreshTokenSync();
    if (!token && !shouldUseCookieSession() && !refreshToken) {
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

  async fetchNoteChanges(since?: string): Promise<ChangeSetPayload<any>> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const res = await authedFetch(`${getBaseUrl()}/notes/changes${query}`);
    return toChangeSetPayload<any>(res);
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
    return deserializeNote(note);
  },

  async createNote(data: CreateNoteDto): Promise<Note> {
    const encryptedData = encryptNotePayload({
      ...data,
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    });
    
    const res = await authedFetch(`${getBaseUrl()}/notes`, {
      method: 'POST',
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return deserializeNote(note);
  },

  async updateNote(id: string, data: UpdateNoteDto): Promise<Note> {
    const encryptedData = encryptNotePayload(data);
    // Always update updatedAt
    encryptedData.updatedAt = encrypt(new Date().toISOString());

    const res = await authedFetch(`${getBaseUrl()}/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return deserializeNote(note);
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

  async fetchTaskChanges(since?: string, parentNoteId?: string): Promise<ChangeSetPayload<any>> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (parentNoteId) params.set('parentNoteId', parentNoteId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const res = await authedFetch(`${getBaseUrl()}/tasks/changes${suffix}`);
    return toChangeSetPayload<any>(res);
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
    const encryptedData = encryptTaskPayload({
      ...data,
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      position: data.position !== undefined ? data.position : 0,
    });
    
    const res = await authedFetch(`${getBaseUrl()}/tasks`, {
      method: 'POST',
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return deserializeTask(task);
  },

  async updateTask(id: string, data: UpdateTaskDto): Promise<Task> {
    const encryptedData = encryptTaskPayload(data);
    encryptedData.updatedAt = encrypt(new Date().toISOString());

    const res = await authedFetch(`${getBaseUrl()}/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return deserializeTask(task);
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

  async syncNotes(operations: BulkSyncOperation<CreateNoteDto | UpdateNoteDto>[]): Promise<{ results: BulkSyncResult<Note>[]; serverTime: string }> {
    const payload = {
      operations: operations.map((operation) => ({
        ...operation,
        ...(operation.data ? { data: encryptNotePayload(operation.data as any) } : {}),
      })),
    };
    const res = await authedFetch(`${getBaseUrl()}/notes/sync`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await handleResponse(res);
    return {
      results: ensureArrayPayload((data as any)?.results).map((result: any) => ({
        ...result,
        item: result.item ? deserializeNote(result.item) : undefined,
      })),
      serverTime: typeof (data as any)?.serverTime === 'string' ? (data as any).serverTime : new Date().toISOString(),
    };
  },

  async syncTasks(operations: BulkSyncOperation<CreateTaskDto | UpdateTaskDto>[]): Promise<{ results: BulkSyncResult<Task>[]; serverTime: string }> {
    const payload = {
      operations: operations.map((operation) => ({
        ...operation,
        ...(operation.data ? { data: encryptTaskPayload(operation.data as any) } : {}),
      })),
    };
    const res = await authedFetch(`${getBaseUrl()}/tasks/sync`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await handleResponse(res);
    return {
      results: ensureArrayPayload((data as any)?.results).map((result: any) => ({
        ...result,
        item: result.item ? deserializeTask(result.item) : undefined,
      })),
      serverTime: typeof (data as any)?.serverTime === 'string' ? (data as any).serverTime : new Date().toISOString(),
    };
  },
};
