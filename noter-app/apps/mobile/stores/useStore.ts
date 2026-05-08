import { create } from 'zustand';
import 'react-native-get-random-values';
import * as Crypto from 'expo-crypto';
import { Note, Task, CreateNoteDto, UpdateNoteDto, CreateTaskDto, UpdateTaskDto, SyncConflictEntity, SyncConflictItem, SyncHealthSnapshot, encrypt, decrypt, decryptWithSource, hasEncryptionKey, isV3Ciphertext, normalizeId } from '@repo/shared';
import { fetchWithAuth, login as apiLogin, register as apiRegister, logout as apiLogout, probeBackendReachability, setAuthToken, initApiUrl, setUnauthorizedHandler, setTokenUpdateHandler } from '../services/api';
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
import { log } from '../services/logger';

let wasOffline = false;
let initPromise: Promise<void> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let notesFetchPromise: Promise<void> | null = null;
const taskFetchPromises = new Map<string, Promise<void>>();
let collectionsRefreshPromise: Promise<void> | null = null;
let lastRemoteCollectionsSyncAt = 0;
let reconnectSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotesDeltaCursor: string | null = null;
let lastTasksDeltaCursor: string | null = null;
let lastNotesFullSyncAt = 0;
let lastTasksFullSyncAt = 0;
let offlineSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
const offlineSyncRetryState = new Map<string, { attempt: number; nextRetryAt: number }>();
const DELTA_SYNC_WINDOW_MS = 5 * 60 * 1000;
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
  syncConflicts: SyncConflictItem[];
  syncHealth: SyncHealthSnapshot;
  activeProjectId: string | null;
  token: string | null;
  isInitialized: boolean;
  notificationsEnabled: boolean;
  securityLocked: boolean;
  unlockedProtectedNoteIds: string[];
  
  // UI Actions
  setActiveProject: (id: string | null) => void;
  dismissSyncConflict: (key: string) => void;
  clearSyncConflicts: () => void;
  setViewMode: (mode: 'list' | 'tree') => void;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setSecurityLocked: (locked: boolean) => Promise<void>;
  init: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  refreshCollections: (options?: { force?: boolean }) => Promise<void>;
  
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

const getNonEmptyText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const getTaskTitleFallback = () => i18n.t('common.untitled');

const getTaskTitleFromValue = (value: unknown): string => {
  const decrypted = decryptOrFallback(value, '');
  return getNonEmptyText(decrypted, getTaskTitleFallback());
};

const readStoredAuthToken = async (): Promise<string | null> => {
  const directToken = await SecureStore.getItemAsync('token');
  if (directToken) {
    return directToken;
  }

  const legacyToken = await SecureStore.getItemAsync('auth_token');
  if (legacyToken) {
    await SecureStore.setItemAsync('token', legacyToken).catch(() => {});
    return legacyToken;
  }

  return null;
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

const taskFetchKey = () => '__all__';

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

const parseTaskDateOrNull = (value: unknown): string | null => {
  const decrypted = decryptOrFallback(value, '');
  if (!decrypted) return null;
  const parsed = new Date(decrypted);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseTaskIsoDate = (value: unknown): string => {
  const decrypted = decryptOrFallback(value, '');
  if (!decrypted) return new Date().toISOString();
  const parsed = new Date(decrypted);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const parseTaskPosition = (value: unknown): number => {
  const decrypted = decryptOrFallback(value, '');
  const parsed = Number(decrypted);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeTaskRelationId = (value: unknown): string | undefined => {
  const normalized = normalizeId(decryptOrFallback(value, ''));
  return normalized || undefined;
};

const normalizeTaskClientId = (value: unknown): string | undefined => {
  const decrypted = decryptOptionalString(value);
  return decrypted || undefined;
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
  title: getTaskTitleFromValue(task.title),
  description: task.description ? decryptOrFallback(task.description, '') : '',
  completed: parseTaskCompleted(task.completed),
  priority: parseTaskPriority(task.priority),
  dueDate: parseTaskDateOrNull(task.dueDate),
  recurrenceType: task.recurrenceType ? (() => { try { return decrypt(task.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
  recurrenceDays: task.recurrenceDays ? (() => { try { return JSON.parse(decrypt(task.recurrenceDays)) } catch { return [] } })() : [],
  reminderEnabled: task.reminderEnabled ? (() => { try { return decrypt(task.reminderEnabled) === 'true' } catch { return false } })() : false,
  reminderOffsetMinutes: task.reminderOffsetMinutes ? (() => { try { return parseReminderOffsets(decrypt(task.reminderOffsetMinutes)); } catch { return []; } })() : [],
  createdAt: parseTaskIsoDate(task.createdAt),
  updatedAt: parseTaskIsoDate(task.updatedAt),
  parentNoteId: normalizeTaskRelationId(task.parentNoteId),
  parentId: normalizeTaskRelationId(task.parentId),
  clientId: normalizeTaskClientId(task.clientId),
  position: parseTaskPosition(task.position),
});

const processLocalTask = (task: Task): Task => ({
  ...task,
  title: getNonEmptyText(task.title, getTaskTitleFallback()),
  dueDate: parseTaskDateOrNull(task.dueDate),
  parentNoteId: normalizeTaskRelationId(task.parentNoteId),
  parentId: normalizeTaskRelationId(task.parentId),
  clientId: normalizeTaskClientId(task.clientId),
  createdAt: parseTaskIsoDate(task.createdAt),
  updatedAt: parseTaskIsoDate(task.updatedAt),
  position: parseTaskPosition(task.position),
  reminderOffsetMinutes: Array.isArray(task.reminderOffsetMinutes) ? task.reminderOffsetMinutes : [],
});

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

const isSyncConflictError = (error: unknown) => {
  const err = error as any;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const code = String(err?.details?.code ?? err?.code ?? '').toUpperCase();
  return status === 409 || code === 'SYNC_CONFLICT';
};

const getSyncConflictMessage = (entity: 'note' | 'task') => (
  entity === 'note'
    ? 'Anteckningen har ändrats på en annan enhet. Synka och granska innan du skriver över.'
    : 'Uppgiften har ändrats på en annan enhet. Synka och granska innan du skriver över.'
);

const getSyncConflictItem = <T,>(error: unknown): T | null => {
  const err = error as any;
  const item = err?.details?.item ?? err?.item;
  return item && typeof item === 'object' ? item as T : null;
};

const shouldUseDeltaSync = (cursor: string | null, lastFullSyncAt: number) => (
  Boolean(cursor) && (Date.now() - lastFullSyncAt) < DELTA_SYNC_WINDOW_MS
);

const toChangeSetPayload = <T,>(payload: unknown): { items: T[]; deletedIds: string[]; serverTime: string } => {
  if (Array.isArray(payload)) {
    return {
      items: payload as T[],
      deletedIds: [],
      serverTime: new Date().toISOString(),
    };
  }
  const objectPayload = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  return {
    items: Array.isArray(objectPayload.items) ? objectPayload.items as T[] : [],
    deletedIds: Array.isArray(objectPayload.deletedIds) ? objectPayload.deletedIds.map((item) => String(item)) : [],
    serverTime: typeof objectPayload.serverTime === 'string' ? objectPayload.serverTime : new Date().toISOString(),
  };
};
const SYNC_CONFLICTS_STORAGE_KEY = 'syncConflicts';
const SYNC_HEALTH_STORAGE_KEY = 'syncHealthSnapshot';
const createDefaultSyncHealth = (): SyncHealthSnapshot => ({
  lastSuccessfulNotesSyncAt: null,
  lastSuccessfulTasksSyncAt: null,
  lastCollectionsRefreshAt: null,
  lastHydrationSource: null,
  lastReachabilityCheckAt: null,
  lastReachabilityResult: 'unknown',
  lastResumeAt: null,
  lastConflictAt: null,
});
const sanitizeSyncHealth = (value: unknown): SyncHealthSnapshot => {
  const next = createDefaultSyncHealth();
  if (!value || typeof value !== 'object') return next;
  const source = value as Record<string, unknown>;
  return {
    lastSuccessfulNotesSyncAt: typeof source.lastSuccessfulNotesSyncAt === 'string' ? source.lastSuccessfulNotesSyncAt : null,
    lastSuccessfulTasksSyncAt: typeof source.lastSuccessfulTasksSyncAt === 'string' ? source.lastSuccessfulTasksSyncAt : null,
    lastCollectionsRefreshAt: typeof source.lastCollectionsRefreshAt === 'string' ? source.lastCollectionsRefreshAt : null,
    lastHydrationSource: typeof source.lastHydrationSource === 'string' ? source.lastHydrationSource : null,
    lastReachabilityCheckAt: typeof source.lastReachabilityCheckAt === 'string' ? source.lastReachabilityCheckAt : null,
    lastReachabilityResult: source.lastReachabilityResult === 'reachable' || source.lastReachabilityResult === 'offline' || source.lastReachabilityResult === 'unknown'
      ? source.lastReachabilityResult
      : 'unknown',
    lastResumeAt: typeof source.lastResumeAt === 'string' ? source.lastResumeAt : null,
    lastConflictAt: typeof source.lastConflictAt === 'string' ? source.lastConflictAt : null,
  };
};
const mergeSyncHealth = (current: SyncHealthSnapshot, patch: Partial<SyncHealthSnapshot>) => (
  sanitizeSyncHealth({
    ...current,
    ...patch,
  })
);
const sanitizeSyncConflicts = (value: unknown): SyncConflictItem[] => {
  if (!Array.isArray(value)) return [];
  return value.reduce<SyncConflictItem[]>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === 'string' ? candidate.key : null;
    const entity = candidate.entity === 'note' || candidate.entity === 'task' ? candidate.entity : null;
    const itemId = typeof candidate.itemId === 'string' ? candidate.itemId : null;
    if (!key || !entity || !itemId) return acc;
    acc.push({
      key,
      entity,
      itemId,
      title: typeof candidate.title === 'string' ? candidate.title : itemId,
      message: typeof candidate.message === 'string' ? candidate.message : '',
      occurredAt: typeof candidate.occurredAt === 'number' ? candidate.occurredAt : Date.now(),
      ...(typeof candidate.serverUpdatedAt === 'string' ? { serverUpdatedAt: candidate.serverUpdatedAt } : {}),
      ...(typeof candidate.localBaseUpdatedAt === 'string' ? { localBaseUpdatedAt: candidate.localBaseUpdatedAt } : {}),
    });
    return acc;
  }, []).slice(0, 8);
};
const loadPersistedSyncMetadata = async (): Promise<{ syncConflicts: SyncConflictItem[]; syncHealth: SyncHealthSnapshot }> => {
  const [storedConflicts, storedHealth] = await Promise.all([
    AsyncStorage.getItem(SYNC_CONFLICTS_STORAGE_KEY).catch(() => null),
    AsyncStorage.getItem(SYNC_HEALTH_STORAGE_KEY).catch(() => null),
  ]);
  try {
    return {
      syncConflicts: sanitizeSyncConflicts(storedConflicts ? JSON.parse(storedConflicts) : null),
      syncHealth: sanitizeSyncHealth(storedHealth ? JSON.parse(storedHealth) : null),
    };
  } catch {
    return {
      syncConflicts: [],
      syncHealth: createDefaultSyncHealth(),
    };
  }
};
const persistSyncMetadata = async (syncConflicts: SyncConflictItem[], syncHealth: SyncHealthSnapshot) => {
  await Promise.all([
    AsyncStorage.setItem(SYNC_CONFLICTS_STORAGE_KEY, JSON.stringify(syncConflicts)).catch(() => {}),
    AsyncStorage.setItem(SYNC_HEALTH_STORAGE_KEY, JSON.stringify(syncHealth)).catch(() => {}),
  ]);
};
const reachabilityResult = (reachable: boolean): SyncHealthSnapshot['lastReachabilityResult'] => (
  reachable ? 'reachable' : 'offline'
);

const makeSyncConflictKey = (entity: SyncConflictEntity, itemId: string) => `${entity}:${itemId}`;
const upsertSyncConflict = (conflicts: SyncConflictItem[], conflict: SyncConflictItem) => (
  [conflict, ...conflicts.filter((item) => item.key !== conflict.key)].slice(0, 8)
);
const clearSyncConflictForItem = (
  conflicts: SyncConflictItem[],
  entity: SyncConflictEntity,
  itemId: string,
) => conflicts.filter((item) => item.key !== makeSyncConflictKey(entity, itemId));
const clearSyncConflictsForItems = (
  conflicts: SyncConflictItem[],
  entity: SyncConflictEntity,
  itemIds: string[],
) => {
  if (itemIds.length === 0) return conflicts;
  const keys = new Set(itemIds.map((itemId) => makeSyncConflictKey(entity, itemId)));
  return conflicts.filter((item) => !keys.has(item.key));
};

const getOfflineSyncRetryDelayMs = (attempt: number) => {
  const baseDelay = Math.min(60_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
  return baseDelay + Math.floor(Math.random() * 400);
};

const getOfflineSyncRetryWaitMs = (key: string) => {
  const nextRetryAt = offlineSyncRetryState.get(key)?.nextRetryAt ?? 0;
  return Math.max(0, nextRetryAt - Date.now());
};

const scheduleOfflineSyncRetryForKey = (key: string) => {
  const attempt = (offlineSyncRetryState.get(key)?.attempt ?? 0) + 1;
  const delay = getOfflineSyncRetryDelayMs(attempt);
  offlineSyncRetryState.set(key, { attempt, nextRetryAt: Date.now() + delay });
  return delay;
};

const clearOfflineSyncRetryForKey = (key: string) => {
  offlineSyncRetryState.delete(key);
};

const isRetryableSyncError = (error: unknown) => {
  const err = error as any;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status === 401 || status === 403 || status === 404 || status === 409) return false;
  return status === undefined || status === 408 || status === 429 || status >= 500 || shouldFallbackToOffline(error);
};

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
      log.warn('Task reminder sync failed', error);
    }
  })();
};

const cancelTaskReminderDeferred = (taskId: string) => {
  void cancelTaskReminder(taskId).catch((error) => {
    log.warn('Task reminder cancel failed', error);
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
  syncConflicts: [],
  syncHealth: createDefaultSyncHealth(),
  activeProjectId: null,
  token: null,
  isInitialized: false,
  notificationsEnabled: false,
  securityLocked: false,
  unlockedProtectedNoteIds: [],
  dismissSyncConflict: (key) => set((state) => ({ syncConflicts: state.syncConflicts.filter((item) => item.key !== key) })),
  clearSyncConflicts: () => set({ syncConflicts: [] }),

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
        syncConflicts: [],
        syncHealth: createDefaultSyncHealth(),
      });
      return;
    }
    set({ securityLocked: false });
    const token = get().token;
    if (token) {
      await get().refreshCollections({ force: true });
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
            persistedSyncMetadata,
          ] = await Promise.all([
            measureStartupStage('secureTokenRead', () => readStoredAuthToken()),
            measureStartupStage('notificationsPreferenceRead', () => AsyncStorage.getItem('notificationsEnabled')),
            measureStartupStage('activeProjectRead', () => AsyncStorage.getItem('activeProjectId')),
            measureStartupStage('viewModeRead', () => AsyncStorage.getItem('viewMode')),
            measureStartupStage('syncMetadataRead', () => loadPersistedSyncMetadata()),
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
        set({
          syncConflicts: persistedSyncMetadata.syncConflicts,
          syncHealth: mergeSyncHealth(persistedSyncMetadata.syncHealth, {
            lastHydrationSource: 'bootstrap',
          }),
        });
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
            syncConflicts: [],
            syncHealth: createDefaultSyncHealth(),
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
            tasks: processedLocalTasks,
            syncHealth: mergeSyncHealth(get().syncHealth, {
              lastHydrationSource: 'local-cache',
            }),
          });
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(processedLocalTasks, true, { cancelMissing: true });
          }
        }
      } catch (error: any) {
        log.error(error, { area: 'store.init' });
        set({
          error: error?.message || 'Appstart misslyckades',
          notes: [],
          tasks: [],
          isLoading: false,
          isAuthenticating: false,
          isRefreshingNotes: false,
          isRefreshingTasks: false,
          syncHealth: mergeSyncHealth(get().syncHealth, {
            lastHydrationSource: 'init-error',
          }),
        });
      }

      if (!netInfoUnsubscribe) {
        netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const isOffline = !(state.isConnected && state.isInternetReachable !== false);
          set((currentState) => ({
            isOffline,
            syncHealth: mergeSyncHealth(currentState.syncHealth, {
              lastReachabilityCheckAt: new Date().toISOString(),
              lastReachabilityResult: reachabilityResult(!isOffline),
            }),
          }));
          if (!databaseReady) return;
          if (!isOffline) {
            const refreshAfterSync = wasOffline;
            wasOffline = false;
            if (reconnectSyncTimer) clearTimeout(reconnectSyncTimer);
            reconnectSyncTimer = setTimeout(() => {
              void (async () => {
                const reachable = await probeBackendReachability();
                if (!reachable) {
                  set((currentState) => ({
                    isOffline: true,
                    syncHealth: mergeSyncHealth(currentState.syncHealth, {
                      lastReachabilityCheckAt: new Date().toISOString(),
                      lastReachabilityResult: 'offline',
                      lastResumeAt: new Date().toISOString(),
                    }),
                  }));
                  return;
                }
                set((currentState) => ({
                  isOffline: false,
                  error: null,
                  syncHealth: mergeSyncHealth(currentState.syncHealth, {
                    lastReachabilityCheckAt: new Date().toISOString(),
                    lastReachabilityResult: 'reachable',
                    lastResumeAt: new Date().toISOString(),
                  }),
                }));
                await get().syncOfflineChanges({ refreshAfterSync });
              })();
            }, 800);
          } else {
            wasOffline = true;
          }
        });
      }

      if (databaseReady && storedToken && !get().securityLocked) {
        const socketStartedAt = Date.now();
        get().connectSocket();
        recordStartupStage('socketConnect', Date.now() - socketStartedAt);
        const backendReachable = await probeBackendReachability().catch(() => false);
        set((currentState) => ({
          isOffline: !backendReachable,
          syncHealth: mergeSyncHealth(currentState.syncHealth, {
            lastReachabilityCheckAt: new Date().toISOString(),
            lastReachabilityResult: reachabilityResult(backendReachable),
          }),
        }));
        if (backendReachable) {
          await measureStartupStage('remoteCollectionsRefresh', () => get().refreshCollections({ force: true }));
        }
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
      log.debug('Attempting HTTP sync fallback due to WebSocket issues');
      await get().refreshCollections({ force: true });
      log.debug('HTTP sync fallback completed successfully');
    } catch (error) {
      log.error(error, { area: 'store.httpSyncFallback' });
    }
  },

  refreshCollections: async (options) => {
    if (get().securityLocked) return;
    if (!options?.force && hasRecentRemoteCollectionsSync()) return;
    if (collectionsRefreshPromise) {
      await collectionsRefreshPromise;
      return;
    }
    const refreshPromise = Promise.all([
      get().fetchNotes(),
      get().fetchTasks(),
    ]).then(() => {
      markRemoteCollectionsSynced();
      set((state) => ({
        syncHealth: mergeSyncHealth(state.syncHealth, {
          lastCollectionsRefreshAt: new Date().toISOString(),
        }),
      }));
    });
    collectionsRefreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (collectionsRefreshPromise === refreshPromise) {
        collectionsRefreshPromise = null;
      }
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
      log.warn('Socket initialization failed');
      return;
    }

    // Add connection state monitoring
    const checkConnection = () => {
      const status = (socket as any).connected ? 'connected' : 'disconnected';
      log.debug('Socket status', { status });
      
      if (!(socket as any).connected) {
        log.debug('Socket not connected, will retry sync operations');
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
      lastNotesDeltaCursor = null;
      lastTasksDeltaCursor = null;
      lastNotesFullSyncAt = 0;
      lastTasksFullSyncAt = 0;
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
        await get().refreshCollections({ force: true });
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
    lastNotesDeltaCursor = null;
    lastTasksDeltaCursor = null;
    lastNotesFullSyncAt = 0;
    lastTasksFullSyncAt = 0;
    setAuthToken(null);
    disconnectSocket();
    set({
      token: null,
      notes: [],
      tasks: [],
      activeProjectId: null,
      error: null,
      unlockedProtectedNoteIds: [],
      syncConflicts: [],
      syncHealth: createDefaultSyncHealth(),
    });
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
          const useDelta = shouldUseDeltaSync(lastNotesDeltaCursor, lastNotesFullSyncAt) && get().notes.length > 0;
          const notesResponse = await fetchWithAuth(
            useDelta && lastNotesDeltaCursor
              ? `/notes/changes?since=${encodeURIComponent(lastNotesDeltaCursor)}`
              : '/notes/changes',
            { timeoutMs: 45000 },
          );
          const noteChangeSet = toChangeSetPayload<any>(notesResponse);
          const safeNotes = Array.isArray(noteChangeSet.items) ? noteChangeSet.items : [];
          const deletedNoteIds = noteChangeSet.deletedIds;
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
          const pendingQueue = typeof Database.getSyncQueue === 'function'
            ? await Database.getSyncQueue()
            : [];
          const pendingNoteIds = new Set<string>();
          const pendingNoteClientIds = new Set<string>();
          for (const item of pendingQueue) {
            if (item.entity !== 'NOTE') continue;
            const pendingId = typeof item.data?.id === 'string'
              ? item.data.id
              : typeof item.data?._id === 'string'
                ? item.data._id
                : typeof item.data?.tempId === 'string'
                  ? item.data.tempId
                  : null;
            const pendingClientId = typeof item.data?.clientId === 'string' ? item.data.clientId : null;
            if (pendingId) pendingNoteIds.add(pendingId);
            if (pendingClientId) pendingNoteClientIds.add(pendingClientId);
          }
          const baseNotes = useDelta ? [...get().notes] : [...securedNotes];
          const mergedNotes = [...baseNotes];
          for (const remoteNote of securedNotes) {
            const idx = mergedNotes.findIndex((note) => note._id === remoteNote._id);
            if (idx !== -1) {
              mergedNotes[idx] = remoteNote;
            } else {
              mergedNotes.push(remoteNote);
            }
          }
          const remoteIds = new Set(securedNotes.map((note) => note._id));
          const remoteClientIds = new Set(securedNotes.map((note) => String(note.clientId || '')).filter(Boolean));
          const deletedNoteIdSet = new Set(deletedNoteIds);
          const deletedTaskIdsFromNotes = get().tasks
            .filter((task) => {
              const parentId = normalizeId(task.parentNoteId ?? task.parentId);
              return Boolean(parentId && deletedNoteIdSet.has(parentId));
            })
            .map((task) => task._id);
          const finalNotes = (useDelta
            ? mergedNotes
            : mergedNotes.filter((note) => (
              remoteIds.has(note._id)
              || note._id.startsWith('local_')
              || pendingNoteIds.has(note._id)
              || (typeof note.clientId === 'string' && note.clientId.length > 0 && (pendingNoteClientIds.has(note.clientId) || remoteClientIds.has(note.clientId)))
            )))
            .filter((note) => !deletedNoteIdSet.has(note._id));
          set((state) => ({
            notes: finalNotes,
            tasks: state.tasks.filter((task) => !deletedTaskIdsFromNotes.includes(task._id)),
            activeProjectId: state.activeProjectId && deletedNoteIdSet.has(state.activeProjectId) ? null : state.activeProjectId,
            unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((item) => !deletedNoteIdSet.has(item)),
            isRefreshingNotes: false,
            syncHealth: mergeSyncHealth(state.syncHealth, {
              lastSuccessfulNotesSyncAt: noteChangeSet.serverTime,
              lastHydrationSource: useDelta ? 'remote-delta' : 'remote-full',
            }),
            syncConflicts: clearSyncConflictsForItems(
              clearSyncConflictsForItems(state.syncConflicts, 'note', deletedNoteIds),
              'task',
              deletedTaskIdsFromNotes,
            ),
          }));
          if (deletedNoteIds.length > 0) {
            await Promise.all(deletedNoteIds.map((noteId) => Database.deleteNoteLocal(noteId)));
          }
          if (deletedTaskIdsFromNotes.length > 0) {
            await Promise.all(deletedTaskIdsFromNotes.map((taskId) => Database.deleteTaskLocal(taskId)));
          }
          lastNotesDeltaCursor = noteChangeSet.serverTime;
          if (!useDelta) {
            lastNotesFullSyncAt = Date.now();
          }
          markRemoteCollectionsSynced();
        } else {
          const localNotes = await Database.getNotesLocal();
          const securedNotes = materializeNotesFromEncrypted(localNotes.map(processLocalNote) as any, new Set(get().unlockedProtectedNoteIds));
          set((state) => ({
            notes: securedNotes,
            isRefreshingNotes: false,
            syncHealth: mergeSyncHealth(state.syncHealth, {
              lastHydrationSource: 'local-cache',
            }),
          }));
        }
      } catch (error: any) {
        log.error(error, { area: 'store.fetchNotes' });
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
    const baseUpdatedAt = typeof (data as any)?.baseUpdatedAt === 'string'
      ? (data as any).baseUpdatedAt
      : undefined;
    const clientMutationId = typeof (data as any)?.clientMutationId === 'string'
      ? (data as any).clientMutationId
      : Crypto.randomUUID();
    
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
        encryptedData.baseUpdatedAt = baseUpdatedAt || currentNote.updatedAt;
        encryptedData.clientMutationId = clientMutationId;
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
            syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
          };
        });

        await Database.saveNoteLocal(realNote, true);
        return realNote;
      } catch (error: any) {
        if (isSyncConflictError(error)) {
          const conflictItem = getSyncConflictItem<Note>(error);
          if (conflictItem) {
            const serverNote = materializeNotesFromEncrypted([conflictItem as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
            set((state) => {
              const nextUnlocked = state.unlockedProtectedNoteIds.filter((item) => item !== id);
              return {
                notes: materializeNotesFromEncrypted(
                  state.notes.map((note) => (note._id === id ? serverNote : note)) as any,
                  new Set(nextUnlocked),
                ),
                unlockedProtectedNoteIds: nextUnlocked,
                error: getSyncConflictMessage('note'),
                isLoading: false,
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('note', id),
                  entity: 'note',
                  itemId: id,
                  title: serverNote.title || id,
                  message: getSyncConflictMessage('note'),
                  occurredAt: Date.now(),
                }),
              };
            });
            await Database.saveNoteLocal(serverNote, true);
          } else {
            set((state) => ({
              error: getSyncConflictMessage('note'),
              isLoading: false,
              syncConflicts: upsertSyncConflict(state.syncConflicts, {
                key: makeSyncConflictKey('note', id),
                entity: 'note',
                itemId: id,
                title: currentNote.title || id,
                message: getSyncConflictMessage('note'),
                occurredAt: Date.now(),
              }),
            }));
          }
        } else {
          set({ error: error?.message || String(error), isLoading: false });
        }
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
      encryptedData.baseUpdatedAt = baseUpdatedAt || currentNote.updatedAt;
      encryptedData.clientMutationId = clientMutationId;

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
              notes: materializeNotesFromEncrypted(state.notes.map(n => n._id === id ? realNote : n) as any, new Set(state.unlockedProtectedNoteIds)),
              syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
          }));
          await Database.saveNoteLocal(realNote, true);

          return realNote;
        } catch (error) {
          const isSettingPassword = typeof updateData.password === 'string' && updateData.password.length > 0;
          if (typeof unlockPassword === 'string' || isSettingPassword) throw error;
          if (isSyncConflictError(error)) {
            const conflictItem = getSyncConflictItem<Note>(error);
            if (conflictItem) {
              const serverNote = materializeNotesFromEncrypted([conflictItem as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
              set((state) => ({
                notes: materializeNotesFromEncrypted(
                  state.notes.map((note) => (note._id === id ? serverNote : note)) as any,
                  new Set(state.unlockedProtectedNoteIds),
                ),
                error: getSyncConflictMessage('note'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('note', id),
                  entity: 'note',
                  itemId: id,
                  title: serverNote.title || id,
                  message: getSyncConflictMessage('note'),
                  occurredAt: Date.now(),
                }),
              }));
              await Database.saveNoteLocal(serverNote, true);
            } else {
              set((state) => ({
                error: getSyncConflictMessage('note'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('note', id),
                  entity: 'note',
                  itemId: id,
                  title: currentNote.title || id,
                  message: getSyncConflictMessage('note'),
                  occurredAt: Date.now(),
                }),
              }));
            }
            throw new Error(getSyncConflictMessage('note'));
          }
          const mergedIntoCreate = await Database.mergeIntoQueuedCreate('NOTE', id, encryptedData);
          if (!mergedIntoCreate) {
            await Database.addToSyncQueue('UPDATE', 'NOTE', { id, ...encryptedData });
          }
          if (!shouldFallbackToOffline(error)) throw error;
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
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((item) => item !== id),
        isLoading: false,
        syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
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
      log.error(error, { area: 'store.reorderNotes' });
    }
  },

  fetchTasks: async (parentNoteId) => {
    if (get().securityLocked) {
      set({ isRefreshingTasks: false });
      return;
    }
    const fetchKey = taskFetchKey();
    const inFlight = taskFetchPromises.get(fetchKey);
    if (inFlight) return inFlight;
    const fetchPromise = (async () => {
      set({ isRefreshingTasks: true, error: null });
      try {
        const netState = await NetInfo.fetch();
        if (netState.isConnected) {
          const useDelta = shouldUseDeltaSync(lastTasksDeltaCursor, lastTasksFullSyncAt) && get().tasks.length > 0;
          const tasksResponse = await fetchWithAuth(
            useDelta && lastTasksDeltaCursor
              ? `/tasks/changes?since=${encodeURIComponent(lastTasksDeltaCursor)}`
              : '/tasks/changes',
            { timeoutMs: 30000 },
          );
          const taskChangeSet = toChangeSetPayload<any>(tasksResponse);
          const safeTasks = Array.isArray(taskChangeSet.items) ? taskChangeSet.items : [];
          const deletedTaskIds = taskChangeSet.deletedIds;
          const decryptedTasks = safeTasks.map(processApiTask);
          const localTaskIndex = typeof Database.getLocalTaskSyncIndex === 'function'
            ? await Database.getLocalTaskSyncIndex()
            : new Map<string, string>();
          const tasksToPersist = (decryptedTasks as Task[]).filter((task: Task) => localTaskIndex.get(task._id) !== String(task.updatedAt || ''));
          await persistInBatches(tasksToPersist, 25, (task: Task) => Database.saveTaskLocal(task, true));
          const state = get();
          const baseTasks = useDelta ? [...state.tasks] : [...decryptedTasks];
          const mergedRemoteTasks = [...baseTasks];
          for (const remoteTask of decryptedTasks) {
            const idx = mergedRemoteTasks.findIndex((task) => task._id === remoteTask._id);
            if (idx !== -1) {
              mergedRemoteTasks[idx] = remoteTask;
            } else {
              mergedRemoteTasks.push(remoteTask);
            }
          }
          const serverClientIds = new Set(decryptedTasks.map((t: any) => t.clientId).filter(Boolean));
          const localOnlyTasks = state.tasks.filter((task) => (
            task._id.startsWith('local_task_')
            && (!task.clientId || !serverClientIds.has(task.clientId))
          ));
          const deletedTaskIdSet = new Set(deletedTaskIds);
          const mergedTasks = [...mergedRemoteTasks, ...localOnlyTasks]
            .map(processLocalTask)
            .filter((task) => !deletedTaskIdSet.has(task._id));
          set((state) => ({
            tasks: mergedTasks,
            isRefreshingTasks: false,
            syncHealth: mergeSyncHealth(state.syncHealth, {
              lastSuccessfulTasksSyncAt: taskChangeSet.serverTime,
              lastHydrationSource: useDelta ? 'remote-delta' : 'remote-full',
            }),
            syncConflicts: clearSyncConflictsForItems(state.syncConflicts, 'task', deletedTaskIds),
          }));
          if (deletedTaskIds.length > 0) {
            await Promise.all(deletedTaskIds.map((taskId) => Database.deleteTaskLocal(taskId)));
          }
          lastTasksDeltaCursor = taskChangeSet.serverTime;
          if (!useDelta) {
            lastTasksFullSyncAt = Date.now();
          }
          markRemoteCollectionsSynced();
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(mergedTasks, true, { cancelMissing: true });
          }
        } else {
          const localTasks = await Database.getTasksLocal();
          const mapped = localTasks.map(processLocalTask);
          set((state) => ({
            tasks: mapped,
            isRefreshingTasks: false,
            syncHealth: mergeSyncHealth(state.syncHealth, {
              lastHydrationSource: 'local-cache',
            }),
          }));
          if (get().notificationsEnabled) {
            await syncAllTaskReminders(mapped, true, { cancelMissing: true });
          }
        }
      } catch (error: any) {
        const localTasks = await Database.getTasksLocal();
        const mapped = localTasks.map(processLocalTask);
        set({
          tasks: mapped,
          isRefreshingTasks: false,
          error: shouldSuppressCollectionError(error, mapped.length) ? null : error.message,
        });
        if (get().notificationsEnabled) {
          await syncAllTaskReminders(mapped, true, { cancelMissing: true });
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
      log.error(error, { area: 'store.backgroundRefresh' });
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
    const baseUpdatedAt = typeof (data as any)?.baseUpdatedAt === 'string'
      ? (data as any).baseUpdatedAt
      : currentTask.updatedAt;
    const clientMutationId = typeof (data as any)?.clientMutationId === 'string'
      ? (data as any).clientMutationId
      : Crypto.randomUUID();

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
          log.error(error, { area: 'store.createRecurringTask' });
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
      encryptedData.baseUpdatedAt = baseUpdatedAt;
      encryptedData.clientMutationId = clientMutationId;
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
            syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', id),
          }));
          await Database.saveTaskLocal(realTask, true);
          syncTaskReminderDeferred(realTask, get().notificationsEnabled);

          return realTask;
        } catch (error) {
          if (isSyncConflictError(error)) {
            const conflictItem = getSyncConflictItem<Task>(error);
            if (conflictItem) {
              const serverTask = processApiTask(conflictItem as any);
              set((state) => ({
                tasks: state.tasks.map((task) => (task._id === id ? serverTask : task)),
                error: getSyncConflictMessage('task'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('task', id),
                  entity: 'task',
                  itemId: id,
                  title: serverTask.title || id,
                  message: getSyncConflictMessage('task'),
                  occurredAt: Date.now(),
                }),
              }));
              await Database.saveTaskLocal(serverTask, true);
              syncTaskReminderDeferred(serverTask, get().notificationsEnabled);
            } else {
              set((state) => ({
                error: getSyncConflictMessage('task'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('task', id),
                  entity: 'task',
                  itemId: id,
                  title: currentTask.title || id,
                  message: getSyncConflictMessage('task'),
                  occurredAt: Date.now(),
                }),
              }));
            }
            throw new Error(getSyncConflictMessage('task'));
          }
          const mergedIntoCreate = await Database.mergeIntoQueuedCreate('TASK', id, encryptedData);
          if (!mergedIntoCreate) {
            await Database.addToSyncQueue('UPDATE', 'TASK', { id, ...encryptedData });
          }
          if (!shouldFallbackToOffline(error)) throw error;
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
        syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', id),
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
      log.debug('Deleting orphan tasks', { count: orphans.length });
      for (const t of orphans) {
        await get().deleteTask(t._id);
      }
    } catch (e) {
      log.error(e, { area: 'store.deleteOrphanTasks' });
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
      log.error(error, { area: 'store.reorder' });
      // set({ error: error.message });
    }
  },

  syncOfflineChanges: async (options) => {
    if (get().securityLocked) return;
    if (get().isSyncingOffline) return;
    if (offlineSyncRetryTimer) {
      clearTimeout(offlineSyncRetryTimer);
      offlineSyncRetryTimer = null;
    }
    set({ isSyncingOffline: true });
    const syncStartedAt = Date.now();
    let initialQueueSize = 0;
    let failedItems = 0;
    let oldestItemAgeMs: number | null = null;
    let nextRetryDelayMs: number | null = null;
    try {
      const backendReachable = await probeBackendReachability().catch(() => false);
      if (!backendReachable) {
        set({ isOffline: true });
        return;
      }
      set({ isOffline: false, error: null });
      const fullQueue = await Database.getSyncQueue();
      const queue = typeof Database.getCompressedSyncQueue === 'function'
        ? await Database.getCompressedSyncQueue()
        : fullQueue;
      initialQueueSize = fullQueue.length;
      oldestItemAgeMs = fullQueue.length
        ? Math.max(0, ...fullQueue.map((item) => Date.now() - new Date(item.timestamp).getTime()))
        : null;
      if (queue.length === 0) {
        if (options?.refreshAfterSync) {
          await get().refreshCollections({ force: true });
        }
        return;
      }

      const tempIdMap = new Map<string, string>();
      const noteBulkItems: Array<{ item: any; retryKey: string; operation: any }> = [];
      const taskBulkItems: Array<{ item: any; retryKey: string; operation: any }> = [];
      const reorderItems: any[] = [];

      for (const item of queue) {
        const retryKey = `${item.entity}:${item.action}:${item.id}`;
        const retryWaitMs = getOfflineSyncRetryWaitMs(retryKey);
        if (retryWaitMs > 0) {
          nextRetryDelayMs = nextRetryDelayMs == null ? retryWaitMs : Math.min(nextRetryDelayMs, retryWaitMs);
          continue;
        }
        if (item.action === 'REORDER') {
          reorderItems.push({ item, retryKey });
          continue;
        }
        if (item.entity === 'NOTE') {
          noteBulkItems.push({
            item,
            retryKey,
            operation: item.action === 'CREATE'
              ? { clientOperationId: String(item.id), action: 'CREATE', tempId: item.data.tempId, data: (() => { const { tempId, ...data } = item.data; return data; })() }
              : item.action === 'UPDATE'
                ? { clientOperationId: String(item.id), action: 'UPDATE', id: item.data.id, data: item.data }
                : { clientOperationId: String(item.id), action: 'DELETE', id: item.data.id },
          });
        } else if (item.entity === 'TASK') {
          const mappedData = {
            ...item.data,
            ...(item.data?.id && tempIdMap.has(item.data.id) ? { id: tempIdMap.get(item.data.id) } : {}),
            ...(item.data?.parentNoteId && tempIdMap.has(item.data.parentNoteId) ? { parentNoteId: tempIdMap.get(item.data.parentNoteId) } : {}),
            ...(item.data?.parentId && tempIdMap.has(item.data.parentId) ? { parentId: tempIdMap.get(item.data.parentId) } : {}),
          };
          taskBulkItems.push({
            item: { ...item, data: mappedData },
            retryKey,
            operation: item.action === 'CREATE'
              ? { clientOperationId: String(item.id), action: 'CREATE', tempId: mappedData.tempId, data: (() => { const { tempId, ...data } = mappedData; return data; })() }
              : item.action === 'UPDATE'
                ? { clientOperationId: String(item.id), action: 'UPDATE', id: mappedData.id, data: mappedData }
                : { clientOperationId: String(item.id), action: 'DELETE', id: mappedData.id },
          });
        }
      }

      if (noteBulkItems.length > 0) {
        try {
          const noteResponse = await fetchWithAuth('/notes/sync', {
            method: 'POST',
            body: JSON.stringify({ operations: noteBulkItems.map((entry) => entry.operation) }),
          });
          const noteResultMap = new Map(noteBulkItems.map((entry) => [String(entry.item.id), entry]));
          for (const result of Array.isArray(noteResponse?.results) ? noteResponse.results : []) {
            const source = noteResultMap.get(String(result.clientOperationId));
            if (!source) continue;
            const queueItem = source.item;
            if (result.status === 'applied') {
              if (result.action === 'CREATE' && result.item) {
                const decryptedCreated = materializeNotesFromEncrypted([result.item as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
                const tempId = queueItem.data?.tempId;
                if (tempId) {
                  tempIdMap.set(tempId, decryptedCreated._id);
                  await Database.deleteNoteLocal(tempId);
                }
                await Database.saveNoteLocal(decryptedCreated, true);
                set((state) => {
                  const idx = state.notes.findIndex((note) => note._id === tempId);
                  if (idx !== -1) {
                    const updated = [...state.notes];
                    updated[idx] = decryptedCreated;
                    return { notes: updated };
                  }
                  if (state.notes.some((note) => note._id === decryptedCreated._id)) return state;
                  return { notes: [decryptedCreated, ...state.notes] };
                });
              } else if (result.action === 'UPDATE' && result.item) {
                const decryptedUpdated = materializeNotesFromEncrypted([result.item as any], new Set(get().unlockedProtectedNoteIds))[0] as Note;
                set((state) => ({
                  notes: state.notes.map((note) => note._id === queueItem.data.id ? decryptedUpdated : note),
                  syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', queueItem.data.id),
                }));
                await Database.saveNoteLocal(decryptedUpdated, true);
              } else {
                const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : [queueItem.data.id];
                const deletedTaskIds = Array.isArray(result.deletedTaskIds) ? result.deletedTaskIds : [];
                set((state) => ({
                  notes: state.notes.filter((note) => !deletedIds.includes(note._id)),
                  tasks: state.tasks.filter((task) => !deletedTaskIds.includes(task._id)),
                  activeProjectId: state.activeProjectId && deletedIds.includes(state.activeProjectId) ? null : state.activeProjectId,
                  unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((itemId) => !deletedIds.includes(itemId)),
                  syncConflicts: clearSyncConflictsForItems(
                    clearSyncConflictsForItems(state.syncConflicts, 'note', deletedIds),
                    'task',
                    deletedTaskIds,
                  ),
                }));
                await Promise.all(deletedIds.map((id: string) => Database.deleteNoteLocal(id)));
                await Promise.all(deletedTaskIds.map((id: string) => Database.deleteTaskLocal(id)));
              }
              await Database.removeFromSyncQueue(queueItem.id);
              clearOfflineSyncRetryForKey(source.retryKey);
              continue;
            }
            failedItems += 1;
            const noteId = typeof queueItem.data?.id === 'string' ? queueItem.data.id : String(queueItem.data?.tempId || queueItem.id);
            if (result.status === 'conflict') {
              set((state) => ({
                error: getSyncConflictMessage('note'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('note', noteId),
                  entity: 'note',
                  itemId: noteId,
                  title: typeof queueItem.data?.title === 'string' ? queueItem.data.title : noteId,
                  message: getSyncConflictMessage('note'),
                  occurredAt: Date.now(),
                }),
              }));
            }
            await Database.removeFromSyncQueue(queueItem.id);
            clearOfflineSyncRetryForKey(source.retryKey);
          }
        } catch (error) {
          failedItems += noteBulkItems.length;
          if ((error as any)?.status === 401) return;
          for (const entry of noteBulkItems) {
            if (isRetryableSyncError(error)) {
              const delay = scheduleOfflineSyncRetryForKey(entry.retryKey);
              nextRetryDelayMs = nextRetryDelayMs == null ? delay : Math.min(nextRetryDelayMs, delay);
            } else {
              await Database.removeFromSyncQueue(entry.item.id);
              clearOfflineSyncRetryForKey(entry.retryKey);
            }
          }
          log.error(error, { area: 'store.syncBulkNotes' });
        }
      }

      if (taskBulkItems.length > 0) {
        try {
          const taskResponse = await fetchWithAuth('/tasks/sync', {
            method: 'POST',
            body: JSON.stringify({ operations: taskBulkItems.map((entry) => entry.operation) }),
          });
          const taskResultMap = new Map(taskBulkItems.map((entry) => [String(entry.item.id), entry]));
          for (const result of Array.isArray(taskResponse?.results) ? taskResponse.results : []) {
            const source = taskResultMap.get(String(result.clientOperationId));
            if (!source) continue;
            const queueItem = source.item;
            if (result.status === 'applied') {
              if ((result.action === 'CREATE' || result.action === 'UPDATE') && result.item) {
                const decryptedTask = processApiTask(result.item);
                if (result.action === 'CREATE' && queueItem.data?.tempId) {
                  tempIdMap.set(queueItem.data.tempId, decryptedTask._id);
                  await Database.deleteTaskLocal(queueItem.data.tempId);
                }
                await Database.saveTaskLocal(decryptedTask, true);
                set((state) => {
                  const idx = state.tasks.findIndex((task) => task._id === (queueItem.data?.tempId || queueItem.data?.id));
                  if (idx !== -1) {
                    const updated = [...state.tasks];
                    updated[idx] = decryptedTask;
                    return {
                      tasks: updated,
                      syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', queueItem.data?.id || queueItem.data?.tempId),
                    };
                  }
                  if (state.tasks.some((task) => task._id === decryptedTask._id)) return state;
                  return { tasks: [...state.tasks, decryptedTask] };
                });
              } else {
                const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : [queueItem.data.id];
                set((state) => ({
                  tasks: state.tasks.filter((task) => !deletedIds.includes(task._id)),
                  syncConflicts: clearSyncConflictsForItems(state.syncConflicts, 'task', deletedIds),
                }));
                await Promise.all(deletedIds.map((id: string) => Database.deleteTaskLocal(id)));
              }
              await Database.removeFromSyncQueue(queueItem.id);
              clearOfflineSyncRetryForKey(source.retryKey);
              continue;
            }
            failedItems += 1;
            const taskId = typeof queueItem.data?.id === 'string' ? queueItem.data.id : String(queueItem.data?.tempId || queueItem.id);
            if (result.status === 'conflict') {
              set((state) => ({
                error: getSyncConflictMessage('task'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('task', taskId),
                  entity: 'task',
                  itemId: taskId,
                  title: typeof queueItem.data?.title === 'string' ? queueItem.data.title : taskId,
                  message: getSyncConflictMessage('task'),
                  occurredAt: Date.now(),
                }),
              }));
            }
            await Database.removeFromSyncQueue(queueItem.id);
            clearOfflineSyncRetryForKey(source.retryKey);
          }
        } catch (error) {
          failedItems += taskBulkItems.length;
          if ((error as any)?.status === 401) return;
          for (const entry of taskBulkItems) {
            if (isRetryableSyncError(error)) {
              const delay = scheduleOfflineSyncRetryForKey(entry.retryKey);
              nextRetryDelayMs = nextRetryDelayMs == null ? delay : Math.min(nextRetryDelayMs, delay);
            } else {
              await Database.removeFromSyncQueue(entry.item.id);
              clearOfflineSyncRetryForKey(entry.retryKey);
            }
          }
          log.error(error, { area: 'store.syncBulkTasks' });
        }
      }

      for (const { item, retryKey } of reorderItems) {
        if (item.data.id && tempIdMap.has(item.data.id)) item.data.id = tempIdMap.get(item.data.id);
        if (item.data._id && tempIdMap.has(item.data._id)) item.data._id = tempIdMap.get(item.data._id);
        if (item.data.parentNoteId && tempIdMap.has(item.data.parentNoteId)) item.data.parentNoteId = tempIdMap.get(item.data.parentNoteId);
        if (item.data.parentId && tempIdMap.has(item.data.parentId)) item.data.parentId = tempIdMap.get(item.data.parentId);
        if (item.data.notes && Array.isArray(item.data.notes)) {
          item.data.notes = item.data.notes.map((n: any) => ({
            ...n,
            _id: tempIdMap.get(n._id) || n._id,
            parentId: (n.parentId && tempIdMap.get(n.parentId)) || n.parentId,
          }));
        }
        if (item.data.tasks && Array.isArray(item.data.tasks)) {
          item.data.tasks = item.data.tasks.map((t: any) => ({
            ...t,
            _id: tempIdMap.get(t._id) || t._id,
          }));
        }
        try {
          await fetchWithAuth(item.entity === 'NOTE' ? '/notes/reorder' : '/tasks/reorder', {
            method: 'PUT',
            body: JSON.stringify(item.data),
          });
          await Database.removeFromSyncQueue(item.id);
          clearOfflineSyncRetryForKey(retryKey);
        } catch (error) {
          failedItems += 1;
          if ((error as any)?.status === 401) return;
          if (isRetryableSyncError(error)) {
            const delay = scheduleOfflineSyncRetryForKey(retryKey);
            nextRetryDelayMs = nextRetryDelayMs == null ? delay : Math.min(nextRetryDelayMs, delay);
          } else {
            await Database.removeFromSyncQueue(item.id);
            clearOfflineSyncRetryForKey(retryKey);
          }
          log.error(error, { area: 'store.syncReorder', item: { id: item.id, entity: item.entity } });
        }
      }
      
      await get().refreshCollections({ force: true });
    } catch (error) {
      log.error(error, { area: 'store.syncOfflineChanges' });
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
      if (nextRetryDelayMs != null) {
        offlineSyncRetryTimer = setTimeout(() => {
          void get().syncOfflineChanges();
        }, nextRetryDelayMs + 50);
      }
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

useStore.subscribe((state, prevState) => {
  if (state.syncConflicts === prevState.syncConflicts && state.syncHealth === prevState.syncHealth) {
    return;
  }
  void persistSyncMetadata(state.syncConflicts, state.syncHealth);
});
