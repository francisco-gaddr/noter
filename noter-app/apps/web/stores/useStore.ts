import { create } from 'zustand';
import { Note, Task, UpdateTaskDto, User, SyncConflictEntity, SyncConflictItem, SyncHealthSnapshot, decrypt, encrypt, hasEncryptionKey, normalizeId, normalizeNoteType } from '@repo/shared';
import { api, getApiBaseUrl, getUUID, probeBackendReachability, setApiAuthTokenListener, setApiBaseUrl, setApiRefreshToken, setApiToken } from '../services/api';
import { socket, connectSocket, disconnectSocket, setSocketToken } from '../services/socket';
import { db } from '../services/db';
import deepmerge from 'deepmerge';
import { uniqBy } from 'lodash';
import CryptoJS from 'crypto-js';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '../services/ai/security';
import i18n from '../app/i18n';
import { getWebAuthTokenSync, getWebRefreshTokenSync, setWebAuthToken, setWebRefreshToken } from '../services/authStorage';

let networkListenersReady = false;
let notesFetchPromise: Promise<void> | null = null;
const taskFetchPromises = new Map<string, Promise<void>>();
let reconnectSyncTimer: ReturnType<typeof setTimeout> | null = null;
let collectionsRefreshPromise: Promise<void> | null = null;
let lastCollectionsRefreshAt = 0;
let lastNotesDeltaCursor: string | null = null;
let lastTasksDeltaCursor: string | null = null;
let lastNotesFullSyncAt = 0;
let lastTasksFullSyncAt = 0;
let offlineSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
const offlineSyncRetryState = new Map<string, { attempt: number; nextRetryAt: number }>();
const taskFetchKey = () => '__all__';
const markCollectionsRefreshed = () => {
  lastCollectionsRefreshAt = Date.now();
};
const hasRecentCollectionsRefresh = () => Date.now() - lastCollectionsRefreshAt < 5000;
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
const runWithConcurrency = async <T,>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) => {
  let currentIndex = 0;
  const size = Math.max(1, concurrency);
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (currentIndex < items.length) {
      const item = items[currentIndex++];
      await worker(item);
      await yieldToEventLoop();
    }
  });
  await Promise.all(runners);
};

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
const dedupeById = <T extends { _id: string }>(items: T[]) => Array.from(new Map(items.map((item) => [item._id, item])).values());
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
const loadPersistedSyncMetadata = (): { syncConflicts: SyncConflictItem[]; syncHealth: SyncHealthSnapshot } => {
  if (typeof window === 'undefined') {
    return { syncConflicts: [], syncHealth: createDefaultSyncHealth() };
  }
  try {
    return {
      syncConflicts: sanitizeSyncConflicts(JSON.parse(localStorage.getItem(SYNC_CONFLICTS_STORAGE_KEY) || '[]')),
      syncHealth: sanitizeSyncHealth(JSON.parse(localStorage.getItem(SYNC_HEALTH_STORAGE_KEY) || 'null')),
    };
  } catch {
    return { syncConflicts: [], syncHealth: createDefaultSyncHealth() };
  }
};
const persistSyncMetadata = (syncConflicts: SyncConflictItem[], syncHealth: SyncHealthSnapshot) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SYNC_CONFLICTS_STORAGE_KEY, JSON.stringify(syncConflicts));
  localStorage.setItem(SYNC_HEALTH_STORAGE_KEY, JSON.stringify(syncHealth));
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
  const conflictKeys = new Set(itemIds.map((itemId) => makeSyncConflictKey(entity, itemId)));
  return conflicts.filter((item) => !conflictKeys.has(item.key));
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
  return status === undefined || status === 408 || status === 429 || status >= 500;
};
const readElectronSettings = async (keys: string[]) => {
  if (typeof window === 'undefined') return {};
  const mlc = (window as any).mlc;
  if (!mlc?.isElectron) return {};
  if (typeof mlc.getManySettings === 'function') {
    try {
      return await mlc.getManySettings(keys);
    } catch {}
  }
  if (typeof mlc.getSetting !== 'function') return {};
  const entries = await Promise.all(keys.map(async (key) => [key, await mlc.getSetting(key).catch(() => null)] as const));
  return Object.fromEntries(entries);
};

const readElectronSession = async () => {
  if (typeof window === 'undefined') return { token: null, refreshToken: null, user: null };
  const mlc = (window as any).mlc;
  if (!mlc?.isElectron || typeof mlc.getSession !== 'function') {
    return { token: null, refreshToken: null, user: null };
  }
  try {
    const session = await mlc.getSession();
    return {
      token: typeof session?.token === 'string' ? session.token : null,
      refreshToken: typeof session?.refreshToken === 'string' ? session.refreshToken : null,
      user: session?.user ?? null,
    };
  } catch {
    return { token: null, refreshToken: null, user: null };
  }
};

const shouldLogElectronDataDebug = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'file:') return false;
  try {
    return localStorage.getItem('debugElectronDataFlow') === '1';
  } catch {
    return false;
  }
};

const redactDebugValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactDebugValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = String(k).toLowerCase();
      if (
        key === 'authorization' ||
        key === 'password' ||
        key === 'unlockpassword' ||
        key === 'token' ||
        key === 'refreshtoken' ||
        key === 'secret' ||
        key === 'wrappeddatakey' ||
        key === 'encryptionsalt' ||
        key === 'localdatakey'
      ) {
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = redactDebugValue(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    const bearer = value.match(/^\s*bearer\s+(.+)$/i);
    if (bearer) return 'Bearer [REDACTED]';
  }
  return value;
};

const logElectronDataDebug = (stage: string, payload: Record<string, unknown>) => {
  if (!shouldLogElectronDataDebug()) return;
  console.info('[ElectronDataDebug]', stage, redactDebugValue(payload));
};

const setElectronSession = (value: Partial<{ token: string | null; refreshToken: string | null; user: User | null }>) => {
  if (typeof window === 'undefined') return;
  const mlc = (window as any).mlc;
  if (!mlc?.setSession) return;
  mlc.setSession(value);
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
    return decryptOrRawString(value) === 'true';
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
    return normalize(decryptOrRawString(value));
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

const parseNoteDateValue = (value: unknown): string => {
  if (typeof value !== 'string') return new Date().toISOString();
  try {
    return decrypt(value);
  } catch {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : value;
  }
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

const clearReminderTimer = (taskId: string) => {
  const existing = reminderTimers.get(taskId);
  if (existing && existing.length > 0) {
    existing.forEach((timeoutId) => clearTimeout(timeoutId));
    reminderTimers.delete(taskId);
  }
};

const clearReminderTimers = (taskIds: Iterable<string>) => {
  for (const taskId of taskIds) {
    clearReminderTimer(taskId);
  }
};

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
    type: normalizeNoteType(note.type ? decryptOrRawString(note.type) : 'note'),
    parentId: note.parentId ? (decryptOrRawString(note.parentId) as any) : null,
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
      let projectIcon: string | undefined = undefined;
      let projectIconColor: string | undefined = undefined;
      if (isDirectlyLockedProject) {
        projectIcon = note.__rawEncryptedIcon ? (() => { try { return decrypt(note.__rawEncryptedIcon) } catch { return note.__rawEncryptedIcon } })() : undefined;
        projectIconColor = note.__rawEncryptedIconColor ? (() => { try { return decrypt(note.__rawEncryptedIconColor) } catch { return note.__rawEncryptedIconColor } })() : undefined;
      }
      return {
        ...note,
        title: isDirectlyLockedProject ? i18n.t('project.locked') : i18n.t('note.locked'),
        content: '',
        tags: [],
        icon: isDirectlyLockedProject ? projectIcon : undefined,
        iconColor: isDirectlyLockedProject ? projectIconColor : undefined,
        locked: true,
      };
    }
    return {
      ...note,
      title: String(decryptOrRawString(note.__rawEncryptedTitle || note.title) ?? ''),
      content: String(decryptOrRawString(note.__rawEncryptedContent || note.content) ?? ''),
      tags: Array.isArray(note.__rawEncryptedTags)
        ? note.__rawEncryptedTags.map((t: any) => decryptOrRawString(t))
        : [],
      icon: note.__rawEncryptedIcon ? String(decryptOrRawString(note.__rawEncryptedIcon) ?? '') : undefined,
      iconColor: note.__rawEncryptedIconColor ? String(decryptOrRawString(note.__rawEncryptedIconColor) ?? '') : undefined,
      locked: parseNoteLocked(note.locked),
    };
  });
};

type ProtectedVisibilityState = {
  notes: Note[];
  tasks: Task[];
  selectedNoteId: string | null;
  selectedTaskListId: string | null;
  activeProjectId: string | null;
  activeTab: 'notes' | 'tasks';
  unlockedProtectedNoteIds: string[];
  transientUnlockedProtectedNoteIds: string[];
};

const toUnlockedIdSet = (ids: string[] = []) =>
  new Set(ids.map((id) => normalizeId(id)).filter((id): id is string => Boolean(id)));

const isTaskReadableWithLocks = (
  task: Pick<Task, 'parentNoteId' | 'parentId'>,
  noteMap: Map<string, Note>,
  unlockedIds: Set<string>,
) => {
  const parentId = normalizeId((task as any).parentNoteId ?? (task as any).parentId);
  if (!parentId) return true;
  const parentNote = noteMap.get(parentId);
  if (!parentNote) return false;
  return !findBlockingLockedAncestor(parentNote as any, noteMap as any, unlockedIds as any);
};

const filterTasksByLockState = (tasks: Task[], notes: Note[], unlockedProtectedNoteIds: string[]) => {
  const noteMap = buildSecurityNoteMap(notes as any) as Map<string, Note>;
  const unlockedIds = toUnlockedIdSet(unlockedProtectedNoteIds);
  return tasks.filter((task) => isTaskReadableWithLocks(task, noteMap, unlockedIds));
};

const filterEncryptedTasksByLockState = (tasks: any[], notes: Note[], unlockedProtectedNoteIds: string[]) => {
  const noteMap = buildSecurityNoteMap(notes as any) as Map<string, Note>;
  const unlockedIds = toUnlockedIdSet(unlockedProtectedNoteIds);
  return tasks.filter((task) => isTaskReadableWithLocks(task, noteMap, unlockedIds));
};

const syncPersistedSelections = (selectedNoteId: string | null, selectedTaskListId: string | null) => {
  if (typeof window === 'undefined') return;
  if (selectedNoteId) {
    localStorage.setItem('lastSelectedNoteId', selectedNoteId);
    localStorage.setItem('selectedNoteId', selectedNoteId);
  } else {
    localStorage.removeItem('lastSelectedNoteId');
    localStorage.removeItem('selectedNoteId');
  }
  if (selectedTaskListId) {
    localStorage.setItem('lastSelectedTaskListId', selectedTaskListId);
  } else {
    localStorage.removeItem('lastSelectedTaskListId');
  }
};

const collectCascadeNoteIds = (notes: Note[], rootId: string): string[] => {
  const normalizedRootId = normalizeId(rootId);
  if (!normalizedRootId) return [];
  const collected = new Set<string>();
  const queue = [normalizedRootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || collected.has(currentId)) continue;
    collected.add(currentId);
    notes.forEach((note) => {
      const parentId = normalizeId(note.parentId);
      const noteId = normalizeId(note._id);
      if (noteId && parentId === currentId && !collected.has(noteId)) {
        queue.push(noteId);
      }
    });
  }
  return Array.from(collected);
};

const collectTaskIdsForNotes = (tasks: Task[], noteIds: Iterable<string>): string[] => {
  const noteIdSet = new Set(Array.from(noteIds).map((id) => normalizeId(id)).filter((id): id is string => Boolean(id)));
  return tasks
    .map((task) => {
      const parentNoteId = normalizeId((task as any).parentNoteId ?? (task as any).parentId);
      return parentNoteId && noteIdSet.has(parentNoteId) ? normalizeId(task._id) : null;
    })
    .filter((id): id is string => Boolean(id));
};

const deriveCascadeDeletionState = (
  state: ProtectedVisibilityState,
  deletedNoteIds: string[],
  deletedTaskIds: string[] = [],
) => {
  const deletedNoteIdSet = new Set(deletedNoteIds.map((id) => normalizeId(id)).filter((id): id is string => Boolean(id)));
  const deletedTaskIdSet = new Set(deletedTaskIds.map((id) => normalizeId(id)).filter((id): id is string => Boolean(id)));
  return deriveProtectedVisibilityState(state, {
    notes: state.notes.filter((note) => !deletedNoteIdSet.has(normalizeId(note._id) || '')),
    tasks: state.tasks.filter((task) => !deletedTaskIdSet.has(normalizeId(task._id) || '')),
    selectedNoteId: deletedNoteIdSet.has(normalizeId(state.selectedNoteId) || '') ? null : state.selectedNoteId,
    selectedTaskListId: deletedNoteIdSet.has(normalizeId(state.selectedTaskListId) || '') ? null : state.selectedTaskListId,
    activeProjectId: deletedNoteIdSet.has(normalizeId(state.activeProjectId) || '') ? null : state.activeProjectId,
    unlockedProtectedNoteIds: state.unlockedProtectedNoteIds.filter((id) => !deletedNoteIdSet.has(normalizeId(id) || '')),
    transientUnlockedProtectedNoteIds: state.transientUnlockedProtectedNoteIds.filter((id) => !deletedNoteIdSet.has(normalizeId(id) || '')),
  });
};

const deriveProtectedVisibilityState = (
  state: ProtectedVisibilityState,
  overrides: Partial<ProtectedVisibilityState> = {},
) => {
  const next = { ...state, ...overrides };
  const unlockedIds = toUnlockedIdSet(next.unlockedProtectedNoteIds);
  const noteMap = buildSecurityNoteMap(next.notes as any);
  const keepUnlockedIds = new Set<string>();
  toUnlockedIdSet(next.transientUnlockedProtectedNoteIds).forEach((id) => keepUnlockedIds.add(id));
  const activeProjectId = normalizeId(next.activeProjectId);
  if (activeProjectId && unlockedIds.has(activeProjectId)) {
    keepUnlockedIds.add(activeProjectId);
  }

  const selectedContextId = normalizeId(next.activeTab === 'tasks' ? next.selectedTaskListId : next.selectedNoteId);
  let currentId = selectedContextId;
  const seen = new Set<string>();
  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    if (unlockedIds.has(currentId)) {
      keepUnlockedIds.add(currentId);
    }
    const currentNote = noteMap.get(currentId);
    currentId = normalizeId(currentNote?.parentId);
  }

  const nextUnlocked = next.unlockedProtectedNoteIds.filter((id) => {
    const normalized = normalizeId(id);
    return Boolean(normalized && keepUnlockedIds.has(normalized));
  });
  const rematerializedNotes = materializeNotesFromEncrypted(next.notes as any, new Set(nextUnlocked));
  const rematerializedNoteMap = buildSecurityNoteMap(rematerializedNotes as any);
  const unlockedAfterRelock = new Set(nextUnlocked);
  const selectedNoteId = normalizeId(next.selectedNoteId);
  const selectedTaskListId = normalizeId(next.selectedTaskListId);
  const selectedNoteBlocked = selectedNoteId
    ? findBlockingLockedAncestor(rematerializedNoteMap.get(selectedNoteId) as any, rematerializedNoteMap as any, unlockedAfterRelock as any)
    : null;
  const selectedTaskListBlocked = selectedTaskListId
    ? findBlockingLockedAncestor(rematerializedNoteMap.get(selectedTaskListId) as any, rematerializedNoteMap as any, unlockedAfterRelock as any)
    : null;

  return {
    ...overrides,
    notes: rematerializedNotes,
    tasks: filterTasksByLockState(next.tasks, rematerializedNotes, nextUnlocked),
    unlockedProtectedNoteIds: nextUnlocked,
    ...(selectedNoteBlocked ? { selectedNoteId: null } : {}),
    ...(selectedTaskListBlocked ? { selectedTaskListId: null } : {}),
  };
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
  syncConflicts: SyncConflictItem[];
  syncHealth: SyncHealthSnapshot;
  dismissSyncConflict: (key: string) => void;
  clearSyncConflicts: () => void;

  isAppLocked: boolean;
  setAppLocked: (locked: boolean) => void;
  appLockPasswordHash: string | null;
  setAppLockPassword: (password: string) => void;
  verifyAppLockPassword: (password: string) => boolean;
  autoLockTimeout: number; // in minutes
  setAutoLockTimeout: (minutes: number) => void;
  unlockedProtectedNoteIds: string[];
  transientUnlockedProtectedNoteIds: string[];
  clearTransientUnlockedProtectedNoteIds: () => void;
  
  fetchNotes: () => Promise<void>;
  fetchTasks: (parentNoteId?: string) => Promise<void>;
  refreshCollections: (options?: { force?: boolean }) => Promise<void>;
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
  syncOfflineChanges: (options?: { refreshAfterSync?: boolean }) => Promise<void>;
  hydrate: () => void;
  isHydrated: boolean;
}

export const useStore = create<StoreState>((set, get) => ({
  isHydrated: false,
  user: null,
  token: null,
  activeProjectId: null,
  setActiveProject: (id) => {
    const normalized = id ? normalizeId(id) : null;
    set((state) => deriveProtectedVisibilityState(state, { activeProjectId: normalized }));
    if (typeof window !== 'undefined') {
      if (normalized) {
        localStorage.setItem('activeProjectId', normalized);
      } else {
        localStorage.removeItem('activeProjectId');
      }
    }
    const nextState = get();
    syncPersistedSelections(nextState.selectedNoteId, nextState.selectedTaskListId);
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
        const persistedSyncMetadata = loadPersistedSyncMetadata();
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        const token = getWebAuthTokenSync();
        const language = (localStorage.getItem('language') as 'sv' | 'en') || 'sv';
        const activeTab = (localStorage.getItem('activeTab') as any) || 'notes';
        const savedSortOrder = (localStorage.getItem('sortOrder') as SortOrder) || 'date-desc';
        const selectedNoteId = localStorage.getItem('lastSelectedNoteId') || localStorage.getItem('selectedNoteId') || null;
        const selectedTaskListId = localStorage.getItem('lastSelectedTaskListId') || null;
        const activeProjectIdRaw = localStorage.getItem('activeProjectId') || null;
        const activeProjectId = activeProjectIdRaw ? normalizeId(activeProjectIdRaw) : null;
        const isElectron = Boolean((window as any).mlc?.isElectron);
        const isAppLocked = localStorage.getItem('isAppLocked') === 'true';
        const appLockPasswordHash = localStorage.getItem('appLockPasswordHash');
        const autoLockTimeout = parseInt(localStorage.getItem('autoLockTimeout') || '15', 10);
        const hasElectronSettingsBridge = Boolean((window as any).mlc?.getSetting);

        const shouldLockOnLaunch = Boolean(token && appLockPasswordHash && isElectron);
        const nextLocked = appLockPasswordHash ? (shouldLockOnLaunch ? true : isAppLocked) : false;

        if (token && !hasEncryptionKey()) {
          setWebAuthToken(null);
          setWebRefreshToken(null);
          setApiToken(null);
          setApiRefreshToken(null);
          setSocketToken(null);
          disconnectSocket();
          if (isElectron) {
            setElectronLockState(false);
            setElectronSession({ token: null, refreshToken: null, user: null });
          }
          set({
            user: null,
            token: null,
            language,
            activeTab,
            sortOrder: savedSortOrder,
            selectedNoteId,
            selectedTaskListId,
            activeProjectId,
            isAppLocked: false,
            appLockPasswordHash,
            autoLockTimeout,
            isHydrated: true,
            error: i18n.t('common.reloginToUnlock'),
            syncConflicts: persistedSyncMetadata.syncConflicts,
            syncHealth: mergeSyncHealth(persistedSyncMetadata.syncHealth, {
              lastHydrationSource: 'bootstrap',
            }),
          });
          return;
        }

        set({
          user,
          token,
          language,
          activeTab,
          sortOrder: savedSortOrder,
          selectedNoteId,
          selectedTaskListId,
          activeProjectId,
          isAppLocked: nextLocked,
          appLockPasswordHash,
          autoLockTimeout,
          isHydrated: true,
          syncConflicts: persistedSyncMetadata.syncConflicts,
          syncHealth: mergeSyncHealth(persistedSyncMetadata.syncHealth, {
            lastHydrationSource: 'bootstrap',
          }),
        });
        setElectronLockState(nextLocked);
        setApiToken(token || null);
        setApiRefreshToken(getWebRefreshTokenSync());
        setApiAuthTokenListener((nextToken) => {
            set({ token: nextToken });
            setSocketToken(nextToken);
            setElectronSession({ token: nextToken });
        });
        setSocketToken(token || null);
        if (token) setElectronSession({ token });
        if (user) setElectronSession({ user });
        if (hasElectronSettingsBridge) {
            Promise.all([
                readElectronSettings(['apiBaseUrl', 'apiUrl', 'backendUrl']),
                readElectronSession(),
            ]).then(([settings, session]) => {
                const storedToken = session.token;
                const storedRefreshToken = session.refreshToken;
                const storedUser = session.user;
                const storedApiBaseUrl = settings.apiBaseUrl;
                const storedApiUrl = settings.apiUrl;
                const storedBackendUrl = settings.backendUrl;
                logElectronDataDebug('bootstrap-settings', {
                    hasStoredToken: Boolean(storedToken),
                    hasStoredRefreshToken: Boolean(storedRefreshToken),
                    hasStoredUser: Boolean(storedUser),
                    hasStoredApiBaseUrl: Boolean(storedApiBaseUrl),
                    hasStoredApiUrl: Boolean(storedApiUrl),
                    hasStoredBackendUrl: Boolean(storedBackendUrl),
                });
                if (storedToken && !token) setWebAuthToken(String(storedToken));
                if (storedRefreshToken) {
                    setWebRefreshToken(String(storedRefreshToken));
                    setApiRefreshToken(String(storedRefreshToken));
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
                const effectiveToken = String(storedToken || token || '');
                const effectiveRefreshToken = String(storedRefreshToken || getWebRefreshTokenSync() || '');
                if (effectiveToken && !nextLocked) {
                    get().initSocket();
                    probeBackendReachability().then((reachable) => {
                        set((state) => ({
                          isOffline: !reachable,
                          syncHealth: mergeSyncHealth(state.syncHealth, {
                            lastReachabilityCheckAt: new Date().toISOString(),
                            lastReachabilityResult: reachabilityResult(reachable),
                            lastResumeAt: new Date().toISOString(),
                          }),
                        }));
                        if (!reachable) return;
                        void get().refreshCollections();
                    }).catch(() => {
                        set((state) => ({
                          isOffline: true,
                          syncHealth: mergeSyncHealth(state.syncHealth, {
                            lastReachabilityCheckAt: new Date().toISOString(),
                            lastReachabilityResult: 'offline',
                            lastResumeAt: new Date().toISOString(),
                          }),
                        }));
                    });
                } else if (effectiveRefreshToken && !nextLocked) {
                    Promise.resolve(api.restoreSession()).then((session) => {
                        if (!session?.token) {
                            setWebAuthToken(null);
                            setWebRefreshToken(null);
                            setApiToken(null);
                            setApiRefreshToken(null);
                            setElectronSession({ token: null, refreshToken: null, user: null });
                            set({ user: null, token: null });
                            return;
                        }
                        localStorage.setItem('user', JSON.stringify(session.user));
                        set({ user: session.user, token: session.token, isAppLocked: false });
                        setApiToken(session.token);
                        setApiRefreshToken((session as any).refreshToken || effectiveRefreshToken);
                        setSocketToken(session.token);
                        setElectronSession({
                            token: session.token,
                            refreshToken: (session as any).refreshToken || effectiveRefreshToken,
                            user: session.user,
                        });
                        get().initSocket();
                        probeBackendReachability().then((reachable) => {
                            set((state) => ({
                              isOffline: !reachable,
                              syncHealth: mergeSyncHealth(state.syncHealth, {
                                lastReachabilityCheckAt: new Date().toISOString(),
                                lastReachabilityResult: reachabilityResult(reachable),
                                lastResumeAt: new Date().toISOString(),
                              }),
                            }));
                            if (!reachable) return;
                            void get().refreshCollections();
                        }).catch(() => {
                            set((state) => ({
                              isOffline: true,
                              syncHealth: mergeSyncHealth(state.syncHealth, {
                                lastReachabilityCheckAt: new Date().toISOString(),
                                lastReachabilityResult: 'offline',
                                lastResumeAt: new Date().toISOString(),
                              }),
                            }));
                        });
                    }).catch(() => {});
                }
            }).catch(() => {});
        }
        if (!networkListenersReady) {
            networkListenersReady = true;
            window.addEventListener('online', () => {
                localStorage.removeItem('hideOfflineIndicator');
                if (reconnectSyncTimer) clearTimeout(reconnectSyncTimer);
                reconnectSyncTimer = setTimeout(() => {
                    void (async () => {
                        const reachable = await probeBackendReachability();
                        if (!reachable) {
                            set((state) => ({
                              isOffline: true,
                              syncHealth: mergeSyncHealth(state.syncHealth, {
                                lastReachabilityCheckAt: new Date().toISOString(),
                                lastReachabilityResult: 'offline',
                                lastResumeAt: new Date().toISOString(),
                              }),
                            }));
                            return;
                        }
                        set((state) => ({
                          isOffline: false,
                          error: null,
                          syncHealth: mergeSyncHealth(state.syncHealth, {
                            lastReachabilityCheckAt: new Date().toISOString(),
                            lastReachabilityResult: 'reachable',
                            lastResumeAt: new Date().toISOString(),
                          }),
                        }));
                        await get().syncOfflineChanges({ refreshAfterSync: true });
                    })();
                }, 800);
            });
            window.addEventListener('offline', () => {
                set((state) => ({
                  isOffline: true,
                  error: 'Offline-läge',
                  syncHealth: mergeSyncHealth(state.syncHealth, {
                    lastReachabilityCheckAt: new Date().toISOString(),
                    lastReachabilityResult: 'offline',
                  }),
                }));
            });
            const initiallyOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
            set((state) => ({
              isOffline: initiallyOffline,
              syncHealth: mergeSyncHealth(state.syncHealth, {
                lastReachabilityCheckAt: new Date().toISOString(),
                lastReachabilityResult: initiallyOffline ? 'offline' : 'unknown',
              }),
            }));
        }
        if (!hasElectronSettingsBridge && !nextLocked) {
            if (token) {
                get().initSocket();
                probeBackendReachability().then((reachable) => {
                    set((state) => ({
                      isOffline: !reachable,
                      syncHealth: mergeSyncHealth(state.syncHealth, {
                        lastReachabilityCheckAt: new Date().toISOString(),
                        lastReachabilityResult: reachabilityResult(reachable),
                        lastResumeAt: new Date().toISOString(),
                      }),
                    }));
                    if (!reachable) return;
                    void get().refreshCollections();
                }).catch(() => {
                    set((state) => ({
                      isOffline: true,
                      syncHealth: mergeSyncHealth(state.syncHealth, {
                        lastReachabilityCheckAt: new Date().toISOString(),
                        lastReachabilityResult: 'offline',
                        lastResumeAt: new Date().toISOString(),
                      }),
                    }));
                });
            } else {
                Promise.resolve(api.restoreSession())
                    .then((session) => {
                        if (!session) {
                            localStorage.removeItem('user');
                            set({ user: null, token: null });
                            return;
                        }
                        localStorage.setItem('user', JSON.stringify(session.user));
                        set({ user: session.user, token: session.token, isAppLocked: false });
                        setApiToken(session.token);
                        setSocketToken(session.token);
                        get().initSocket();
                        probeBackendReachability().then((reachable) => {
                            set((state) => ({
                              isOffline: !reachable,
                              syncHealth: mergeSyncHealth(state.syncHealth, {
                                lastReachabilityCheckAt: new Date().toISOString(),
                                lastReachabilityResult: reachabilityResult(reachable),
                                lastResumeAt: new Date().toISOString(),
                              }),
                            }));
                            if (!reachable) return;
                            void get().refreshCollections();
                        }).catch(() => {
                            set((state) => ({
                              isOffline: true,
                              syncHealth: mergeSyncHealth(state.syncHealth, {
                                lastReachabilityCheckAt: new Date().toISOString(),
                                lastReachabilityResult: 'offline',
                                lastResumeAt: new Date().toISOString(),
                              }),
                            }));
                        });
                    })
                    .catch(() => {
                        localStorage.removeItem('user');
                        set({ user: null, token: null });
                    });
            }
        }
    } catch (e) {
        console.error('Failed to hydrate store', e);
        set({ isHydrated: true });
    }
  },

  login: async (username, password) => {
    try {
        lastNotesDeltaCursor = null;
        lastTasksDeltaCursor = null;
        lastNotesFullSyncAt = 0;
        lastTasksFullSyncAt = 0;
        const { user, token, refreshToken } = await api.login(username, password) as any;
        setWebAuthToken(token);
        setWebRefreshToken(refreshToken || null);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.removeItem('isAppLocked');
        set({ user, token, isAppLocked: false });
        setElectronLockState(false);
        setApiToken(token);
        setApiRefreshToken(refreshToken || null);
        setSocketToken(token);
        setElectronSession({ token, refreshToken: refreshToken || null, user });
        get().initSocket();
        const reachable = await probeBackendReachability().catch(() => false);
        set({ isOffline: !reachable });
        if (reachable) {
            await get().refreshCollections({ force: true });
        }
    } catch (error: any) {
        set({ error: error.message });
        throw error;
    }
  },

  register: async (username, password) => {
    try {
        lastNotesDeltaCursor = null;
        lastTasksDeltaCursor = null;
        lastNotesFullSyncAt = 0;
        lastTasksFullSyncAt = 0;
        const { user, token, refreshToken } = await api.register(username, password) as any;
        setWebAuthToken(token);
        setWebRefreshToken(refreshToken || null);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.removeItem('isAppLocked');
        set({ user, token, isAppLocked: false });
        setElectronLockState(false);
        setApiToken(token);
        setApiRefreshToken(refreshToken || null);
        setSocketToken(token);
        setElectronSession({ token, refreshToken: refreshToken || null, user });
        get().initSocket();
        const reachable = await probeBackendReachability().catch(() => false);
        set({ isOffline: !reachable });
        if (reachable) {
            await get().refreshCollections({ force: true });
        }
    } catch (error: any) {
        set({ error: error.message });
        throw error;
    }
  },

  logout: async () => {
    await api.logout().catch(() => {});
    lastNotesDeltaCursor = null;
    lastTasksDeltaCursor = null;
    lastNotesFullSyncAt = 0;
    lastTasksFullSyncAt = 0;
    setWebAuthToken(null);
    setWebRefreshToken(null);
    localStorage.removeItem('user');
    setApiToken(null);
    setApiRefreshToken(null);
    setSocketToken(null);
    setElectronSession({ token: null, refreshToken: null, user: null });
    disconnectSocket();
    set({
      user: null,
      token: null,
      notes: [],
      tasks: [],
      selectedNoteId: null,
      selectedTaskListId: null,
      isAppLocked: false,
      unlockedProtectedNoteIds: [],
      transientUnlockedProtectedNoteIds: [],
      syncConflicts: [],
      syncHealth: createDefaultSyncHealth(),
    });
  },

  notes: [],
  tasks: [],
  unlockedProtectedNoteIds: [],
  transientUnlockedProtectedNoteIds: [],
  pendingCreated: { notes: {}, tasks: {} },
  syncConflicts: [],
  syncHealth: createDefaultSyncHealth(),
  selectedNoteId: null,
  selectedTaskListId: null,
  isLoading: false,
  isOffline: false,
  error: null,
  searchQuery: '',
  sortOrder: 'date-desc',
  activeTab: 'notes',
  dismissSyncConflict: (key) => set((state) => ({ syncConflicts: state.syncConflicts.filter((item) => item.key !== key) })),
  clearSyncConflicts: () => set({ syncConflicts: [] }),
  clearTransientUnlockedProtectedNoteIds: () => set({ transientUnlockedProtectedNoteIds: [] }),
  setActiveTab: (tab) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activeTab', tab);
    }
    set((state) => deriveProtectedVisibilityState(state, { activeTab: tab }));
    const nextState = get();
    syncPersistedSelections(nextState.selectedNoteId, nextState.selectedTaskListId);
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
            transientUnlockedProtectedNoteIds: [],
            activeUsers: {},
            selectedNoteId: null,
            selectedTaskListId: null,
            pendingCreated: { notes: {}, tasks: {} },
            syncConflicts: [],
            syncHealth: createDefaultSyncHealth(),
        });
        disconnectSocket();
    } else {
        set({ isAppLocked: false });
        // Re-fetch data
        get().refreshCollections({ force: true });
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
        set(state => deriveProtectedVisibilityState(state, { notes: uniqBy([decryptedNote, ...state.notes], '_id') as any }));
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
                return deriveProtectedVisibilityState(state, { notes: newNotes as any });
            });
            db.saveNote(decryptedNote); // Cache incoming
        });
    });

    socket.off('note:deleted');
    socket.on('note:deleted', (noteId: string) => {
        set((state) => ({
            ...deriveCascadeDeletionState(state, [noteId]),
            syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', noteId),
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
            title: String(decryptOrRawString(newTask.title) ?? ''),
            description: String(decryptOrRawString(newTask.description) ?? ''),
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
            return {
              tasks: filterTasksByLockState(
                uniqBy([decryptedTask, ...state.tasks], '_id') as any,
                state.notes,
                state.unlockedProtectedNoteIds,
              ),
            };
        });
        db.saveTask(decryptedTask);
        scheduleWebReminder(decryptedTask);
    });

    socket.off('task:updated');
    socket.on('task:updated', (updatedTask: any) => {
        const decryptedTask = {
            ...updatedTask,
            title: String(decryptOrRawString(updatedTask.title) ?? ''),
            description: String(decryptOrRawString(updatedTask.description) ?? ''),
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
            tasks: filterTasksByLockState(
              state.tasks.map(t => t._id === decryptedTask._id ? decryptedTask : t),
              state.notes,
              state.unlockedProtectedNoteIds,
            )
        }));
        db.saveTask(decryptedTask);
        scheduleWebReminder(decryptedTask);
    });

    socket.off('task:deleted');
    socket.on('task:deleted', (taskId: string) => {
        set(state => ({
            tasks: state.tasks.filter(t => t._id !== taskId),
            syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', taskId),
        }));
        db.deleteTask(taskId);
        clearReminderTimer(taskId);
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

  syncOfflineChanges: async (options) => {
      if (get().isAppLocked) return;
      if (offlineSyncRetryTimer) {
          clearTimeout(offlineSyncRetryTimer);
          offlineSyncRetryTimer = null;
      }
      const reachable = await probeBackendReachability().catch(() => false);
      if (!reachable) {
          set({ isOffline: true });
          return;
      }
      set({ isOffline: false, error: null });
      let nextRetryDelayMs: number | null = null;
      const pendingNotes = await db.getPendingSyncNotes();
      const noteOperations: Array<{ source: Note & { deleted?: boolean }; retryKey: string; operation: any }> = [];
      for (const note of pendingNotes) {
          const retryKey = `NOTE:${note._id}`;
          const retryWaitMs = getOfflineSyncRetryWaitMs(retryKey);
          if (retryWaitMs > 0) {
              nextRetryDelayMs = nextRetryDelayMs == null ? retryWaitMs : Math.min(nextRetryDelayMs, retryWaitMs);
              continue;
          }
          if (note.deleted && note._id.startsWith('temp-')) {
              set((state) => ({
                  ...deriveCascadeDeletionState(state, [note._id]),
                  syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', note._id),
              }));
              await db.deleteNote(note._id);
              clearOfflineSyncRetryForKey(retryKey);
              continue;
          }
          noteOperations.push({
              source: note,
              retryKey,
              operation: note.deleted
                  ? { clientOperationId: retryKey, action: 'DELETE', id: note._id }
                  : note._id.startsWith('temp-')
                    ? {
                        clientOperationId: retryKey,
                        action: 'CREATE',
                        tempId: note._id,
                        data: {
                            title: note.title,
                            content: note.content,
                            parentId: note.parentId,
                            order: Number(note.order ?? 0),
                            icon: note.icon,
                            type: note.type,
                            clientId: note.clientId,
                        },
                    }
                    : {
                        clientOperationId: retryKey,
                        action: 'UPDATE',
                        id: note._id,
                        data: {
                            title: note.title,
                            content: note.content,
                            baseUpdatedAt: note.baseUpdatedAt,
                            clientMutationId: note.clientMutationId,
                            locked: Boolean(note.locked),
                            icon: note.icon,
                            type: note.type,
                            order: Number(note.order ?? 0),
                        },
                    },
          });
      }

      const noteOperationMap = new Map(noteOperations.map((item) => [item.operation.clientOperationId, item]));
      const tempNoteIdMap = new Map<string, string>();
      if (noteOperations.length > 0) {
          try {
              const response = await api.syncNotes(noteOperations.map((item) => item.operation));
              for (const result of response.results) {
                  const sourceEntry = noteOperationMap.get(result.clientOperationId);
                  const sourceNote = sourceEntry?.source;
                  const retryKey = sourceEntry?.retryKey ?? `NOTE:${result.itemId || result.id || result.tempId || 'unknown'}`;
                  if (!sourceNote) continue;
                  if (result.status === 'applied') {
                      if (result.action === 'CREATE' && result.item) {
                          const created = result.item;
                          tempNoteIdMap.set(sourceNote._id, created._id);
                          set((state) => ({
                              notes: state.notes.map((note) => note._id === sourceNote._id ? created : note),
                              selectedNoteId: state.selectedNoteId === sourceNote._id ? created._id : state.selectedNoteId,
                              selectedTaskListId: state.selectedTaskListId === sourceNote._id ? created._id : state.selectedTaskListId,
                              syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', sourceNote._id),
                          }));
                          await db.deleteNote(sourceNote._id);
                          await db.saveNote(created, false);
                      } else if (result.action === 'UPDATE' && result.item) {
                          set((state) => ({
                              ...deriveProtectedVisibilityState(state, {
                                  notes: state.notes.map((note) => note._id === sourceNote._id ? result.item! : note) as any,
                              }),
                              syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', sourceNote._id),
                          }));
                          await db.saveNote(result.item, false);
                      } else {
                          const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : [sourceNote._id];
                          const deletedTaskIds = Array.isArray(result.deletedTaskIds) ? result.deletedTaskIds : [];
                          set((state) => ({
                              ...deriveCascadeDeletionState(state, deletedIds, deletedTaskIds),
                              syncConflicts: clearSyncConflictsForItems(
                                  clearSyncConflictsForItems(state.syncConflicts, 'note', deletedIds),
                                  'task',
                                  deletedTaskIds,
                              ),
                          }));
                          await Promise.all(deletedIds.map((noteId) => db.deleteNote(noteId)));
                          await Promise.all(deletedTaskIds.map((taskId) => db.deleteTask(taskId)));
                      }
                      clearOfflineSyncRetryForKey(retryKey);
                      continue;
                  }
                  if (result.status === 'not_found') {
                      set((state) => ({
                          ...deriveCascadeDeletionState(state, [sourceNote._id]),
                          syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', sourceNote._id),
                      }));
                      await db.deleteNote(sourceNote._id);
                      clearOfflineSyncRetryForKey(retryKey);
                      continue;
                  }
                  set((state) => ({
                      error: getSyncConflictMessage('note'),
                      syncConflicts: upsertSyncConflict(state.syncConflicts, {
                          key: makeSyncConflictKey('note', sourceNote._id),
                          entity: 'note',
                          itemId: sourceNote._id,
                          title: sourceNote.title || sourceNote._id,
                          message: getSyncConflictMessage('note'),
                          occurredAt: Date.now(),
                      }),
                  }));
                  clearOfflineSyncRetryForKey(retryKey);
              }
          } catch (e) {
              for (const item of noteOperations) {
                  if (isRetryableSyncError(e)) {
                      const delay = scheduleOfflineSyncRetryForKey(item.retryKey);
                      nextRetryDelayMs = nextRetryDelayMs == null ? delay : Math.min(nextRetryDelayMs, delay);
                  } else {
                      clearOfflineSyncRetryForKey(item.retryKey);
                  }
              }
              console.error('Bulk sync failed for notes', e);
          }
      }

      const pendingTasks = await db.getPendingSyncTasks();
      const taskOperations: Array<{ source: Task & { deleted?: boolean }; retryKey: string; operation: any }> = [];
      for (const task of pendingTasks) {
          const retryKey = `TASK:${task._id}`;
          const retryWaitMs = getOfflineSyncRetryWaitMs(retryKey);
          if (retryWaitMs > 0) {
              nextRetryDelayMs = nextRetryDelayMs == null ? retryWaitMs : Math.min(nextRetryDelayMs, retryWaitMs);
              continue;
          }
          if (task.deleted && task._id.startsWith('temp-')) {
              set((state) => ({
                  tasks: state.tasks.filter((item) => item._id !== task._id),
                  syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', task._id),
              }));
              await db.deleteTask(task._id);
              clearOfflineSyncRetryForKey(retryKey);
              continue;
          }
          const resolvedParentNoteId = task.parentNoteId ? (tempNoteIdMap.get(task.parentNoteId) || task.parentNoteId) : task.parentNoteId;
          taskOperations.push({
              source: task,
              retryKey,
              operation: task.deleted
                  ? { clientOperationId: retryKey, action: 'DELETE', id: task._id }
                  : task._id.startsWith('temp-')
                    ? {
                        clientOperationId: retryKey,
                        action: 'CREATE',
                        tempId: task._id,
                        data: {
                            title: task.title,
                            parentNoteId: resolvedParentNoteId,
                            description: task.description,
                            priority: task.priority,
                            dueDate: task.dueDate,
                            clientId: task.clientId,
                            recurrenceType: task.recurrenceType,
                            recurrenceDays: task.recurrenceDays,
                            reminderEnabled: task.reminderEnabled,
                            reminderOffsetMinutes: task.reminderOffsetMinutes,
                            completed: task.completed,
                            position: task.position,
                        },
                    }
                    : {
                        clientOperationId: retryKey,
                        action: 'UPDATE',
                        id: task._id,
                        data: {
                            title: task.title,
                            baseUpdatedAt: task.baseUpdatedAt,
                            clientMutationId: task.clientMutationId,
                            completed: task.completed,
                            description: task.description,
                            priority: task.priority,
                            dueDate: task.dueDate,
                            recurrenceType: task.recurrenceType,
                            recurrenceDays: task.recurrenceDays,
                            reminderEnabled: task.reminderEnabled,
                            reminderOffsetMinutes: task.reminderOffsetMinutes,
                            parentNoteId: resolvedParentNoteId,
                            position: task.position,
                        },
                    },
          });
      }

      const taskOperationMap = new Map(taskOperations.map((item) => [item.operation.clientOperationId, item]));
      if (taskOperations.length > 0) {
          try {
              const response = await api.syncTasks(taskOperations.map((item) => item.operation));
              for (const result of response.results) {
                  const sourceEntry = taskOperationMap.get(result.clientOperationId);
                  const sourceTask = sourceEntry?.source;
                  const retryKey = sourceEntry?.retryKey ?? `TASK:${result.itemId || result.id || result.tempId || 'unknown'}`;
                  if (!sourceTask) continue;
                  if (result.status === 'applied') {
                      if ((result.action === 'CREATE' || result.action === 'UPDATE') && result.item) {
                          const nextTask = result.item;
                          set((state) => ({
                              tasks: state.tasks.map((task) => task._id === sourceTask._id ? nextTask : task),
                              syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', sourceTask._id),
                          }));
                          if (result.action === 'CREATE') {
                              await db.deleteTask(sourceTask._id);
                          }
                          await db.saveTask(nextTask, false);
                          scheduleWebReminder(nextTask);
                      } else {
                          const deletedTaskIds = Array.isArray(result.deletedIds) ? result.deletedIds : [sourceTask._id];
                          set((state) => ({
                              tasks: state.tasks.filter((task) => !deletedTaskIds.includes(task._id)),
                              syncConflicts: clearSyncConflictsForItems(state.syncConflicts, 'task', deletedTaskIds),
                          }));
                          await Promise.all(deletedTaskIds.map((taskId) => db.deleteTask(taskId)));
                          deletedTaskIds.forEach((taskId) => clearReminderTimer(taskId));
                      }
                      clearOfflineSyncRetryForKey(retryKey);
                      continue;
                  }
                  if (result.status === 'not_found') {
                      set((state) => ({
                          tasks: state.tasks.filter((task) => task._id !== sourceTask._id),
                          syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', sourceTask._id),
                      }));
                      await db.deleteTask(sourceTask._id);
                      clearReminderTimer(sourceTask._id);
                      clearOfflineSyncRetryForKey(retryKey);
                      continue;
                  }
                  set((state) => ({
                      error: getSyncConflictMessage('task'),
                      syncConflicts: upsertSyncConflict(state.syncConflicts, {
                          key: makeSyncConflictKey('task', sourceTask._id),
                          entity: 'task',
                          itemId: sourceTask._id,
                          title: sourceTask.title || sourceTask._id,
                          message: getSyncConflictMessage('task'),
                          occurredAt: Date.now(),
                      }),
                  }));
                  clearOfflineSyncRetryForKey(retryKey);
              }
          } catch (e) {
              for (const item of taskOperations) {
                  if (isRetryableSyncError(e)) {
                      const delay = scheduleOfflineSyncRetryForKey(item.retryKey);
                      nextRetryDelayMs = nextRetryDelayMs == null ? delay : Math.min(nextRetryDelayMs, delay);
                  } else {
                      clearOfflineSyncRetryForKey(item.retryKey);
                  }
              }
              console.error('Bulk sync failed for tasks', e);
          }
      }
      if (options?.refreshAfterSync) {
          await get().fetchNotes();
          setTimeout(() => {
              void get().fetchTasks();
          }, 0);
      }
      if (nextRetryDelayMs != null) {
          offlineSyncRetryTimer = setTimeout(() => {
              void get().syncOfflineChanges();
          }, nextRetryDelayMs + 50);
      }
  },

  fetchNotes: async () => {
    if (get().isAppLocked) {
      set({ isLoading: false });
      return;
    }
    if (notesFetchPromise) return notesFetchPromise;
    logElectronDataDebug('fetchNotes-start', {
      hasToken: Boolean(get().token),
      hasUser: Boolean(get().user),
      apiBaseHost: (() => {
        try { return new URL(getApiBaseUrl()).host; } catch { return 'invalid-url'; }
      })(),
    });
    notesFetchPromise = (async () => {
      set({ isLoading: true, error: null });
      let cachedValidNotes: Note[] = [];
      try {
        const cachedNotes = await db.getAllNotes();
        const validNotesRaw = cachedNotes.filter(n => !(n as any).deleted);
        const validNotes = materializeNotesFromEncrypted(validNotesRaw as any, new Set(get().unlockedProtectedNoteIds));
        cachedValidNotes = validNotes;
        logElectronDataDebug('fetchNotes-cache-loaded', {
          cachedCount: cachedNotes.length,
          validCachedCount: validNotes.length,
        });
        if (validNotes.length > 0) {
            set((state) => ({
              ...deriveProtectedVisibilityState(state, { notes: validNotes }),
              isLoading: false,
            }));
        } else {
            set((state) => ({
              ...deriveProtectedVisibilityState(state, { notes: [] }),
              isLoading: false,
            }));
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

        const useDelta = shouldUseDeltaSync(lastNotesDeltaCursor, lastNotesFullSyncAt) && cachedValidNotes.length > 0;
        const noteChangeSet = await withTimeout(
          api.fetchNoteChanges(useDelta ? lastNotesDeltaCursor || undefined : undefined),
          45000,
        );
        const safeEncryptedNotes = Array.isArray(noteChangeSet.items) ? noteChangeSet.items : [];
        const deletedNoteIds = Array.isArray((noteChangeSet as any).deletedIds)
          ? (noteChangeSet as any).deletedIds.map((item: unknown) => String(item))
          : [];
        const notes = materializeNotesFromEncrypted(safeEncryptedNotes as any, new Set(get().unlockedProtectedNoteIds));
        logElectronDataDebug('fetchNotes-server-loaded', {
          mode: useDelta ? 'delta' : 'full',
          encryptedCount: safeEncryptedNotes.length,
          materializedCount: notes.length,
        });

        const pendingNotes = await db.getPendingSyncNotes();
        const mergedNotes = useDelta ? [...cachedValidNotes] : [...notes];
        const serverNoteMap = new Map(notes.map(n => [n._id, n]));

        for (const serverNote of notes) {
          const idx = mergedNotes.findIndex((note) => note._id === serverNote._id);
          if (idx !== -1) {
            mergedNotes[idx] = serverNote;
          } else {
            mergedNotes.push(serverNote);
          }
        }

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

        const deletedNoteIdSet = new Set(deletedNoteIds);
        const deletedTaskIdsFromNotes = collectTaskIdsForNotes(get().tasks, deletedNoteIds);
        const nextNotesRaw = uniqBy(mergedNotes.filter((note) => !deletedNoteIdSet.has(note._id)), '_id');
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
        set((state) => {
          const baseState = deletedNoteIds.length > 0 || deletedTaskIdsFromNotes.length > 0
            ? { ...state, ...deriveCascadeDeletionState(state, deletedNoteIds, deletedTaskIdsFromNotes) }
            : state;
          const noteExists = (id: string | null) => Boolean(id && nextNotes.some((note) => note._id === id));
          const shouldPruneSelections = nextNotes.length > 0;
          return {
            ...deriveProtectedVisibilityState(baseState as any, {
              notes: nextNotes,
              tasks: (baseState as any).tasks,
              ...(shouldPruneSelections && (baseState as any).selectedNoteId && !noteExists((baseState as any).selectedNoteId) ? { selectedNoteId: null } : {}),
              ...(shouldPruneSelections && (baseState as any).selectedTaskListId && !noteExists((baseState as any).selectedTaskListId) ? { selectedTaskListId: null } : {}),
              ...(shouldPruneSelections && (baseState as any).activeProjectId && !noteExists((baseState as any).activeProjectId) ? { activeProjectId: null } : {}),
            }),
            isLoading: false,
            syncHealth: mergeSyncHealth(state.syncHealth, {
              lastSuccessfulNotesSyncAt: noteChangeSet.serverTime,
              lastHydrationSource: useDelta ? 'remote-delta' : 'remote-full',
            }),
            syncConflicts: clearSyncConflictsForItems(
              clearSyncConflictsForItems(state.syncConflicts, 'note', deletedNoteIds),
              'task',
              deletedTaskIdsFromNotes,
            ),
          };
        });
        const nextState = get();
        syncPersistedSelections(nextState.selectedNoteId, nextState.selectedTaskListId);
        const noteSyncIndex = typeof db.getNoteSyncIndex === 'function'
          ? await db.getNoteSyncIndex()
          : new Map<string, string>();
        if (typeof window !== 'undefined') {
          if (nextNotes.length === 0) {
            syncPersistedSelections(get().selectedNoteId, get().selectedTaskListId);
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

        const notesToPersist = notes.filter((note) => noteSyncIndex.get(note._id) !== String(note.updatedAt || ''));
        await persistInBatches(notesToPersist, 50, (note) => db.saveNote(note));
        if (deletedNoteIds.length > 0) {
          await Promise.all(deletedNoteIds.map((noteId) => db.deleteNote(noteId)));
        }
        if (deletedTaskIdsFromNotes.length > 0) {
          await Promise.all(deletedTaskIdsFromNotes.map((taskId) => db.deleteTask(taskId)));
        }
        lastNotesDeltaCursor = noteChangeSet.serverTime;
        if (!useDelta) {
          lastNotesFullSyncAt = Date.now();
        }
        markCollectionsRefreshed();
      } catch (error: any) {
        logElectronDataDebug('fetchNotes-error', {
          message: error?.message || 'unknown-error',
          name: error?.name || 'Error',
        });
        set({ error: error.message, isLoading: false });
      } finally {
        notesFetchPromise = null;
      }
    })();
    return notesFetchPromise;
  },

  fetchTasks: async (_parentNoteId) => {
    if (get().isAppLocked) {
      set({ isLoading: false });
      return;
    }
    if (notesFetchPromise) {
      await notesFetchPromise;
    } else if (get().notes.length === 0 && get().token) {
      await get().fetchNotes();
    }
    const currentFetchKey = taskFetchKey();
    const inFlight = taskFetchPromises.get(currentFetchKey);
    if (inFlight) return inFlight;
    const fetchPromise = (async () => {
      set({ isLoading: true, error: null });
      let cachedValidTasks: Task[] = [];
      try {
        const cachedTasks = await db.getAllTasks();
        const validTasks = cachedTasks.filter(t => !(t as any).deleted);
        cachedValidTasks = validTasks as Task[];
        if (validTasks.length > 0) {
             const visibleCachedTasks = filterTasksByLockState(validTasks as any, get().notes, get().unlockedProtectedNoteIds);
             set({ tasks: visibleCachedTasks, isLoading: false });
             visibleCachedTasks.forEach(scheduleWebReminder);
        } else {
             set({ tasks: [], isLoading: false });
        }
      } catch (e) {
        console.error('Failed to load tasks from DB', e);
      }

      try {
        // Always try to fetch, regardless of navigator.onLine status
        const useDelta = shouldUseDeltaSync(lastTasksDeltaCursor, lastTasksFullSyncAt) && cachedValidTasks.length > 0;
        const taskChangeSet = await api.fetchTaskChanges(useDelta ? lastTasksDeltaCursor || undefined : undefined);
        const encryptedTasks = Array.isArray(taskChangeSet.items) ? taskChangeSet.items : [];
        const deletedTaskIds = Array.isArray((taskChangeSet as any).deletedIds)
          ? (taskChangeSet as any).deletedIds.map((item: unknown) => String(item))
          : [];
        const readableEncryptedTasks = filterEncryptedTasksByLockState(
          encryptedTasks,
          get().notes,
          get().unlockedProtectedNoteIds,
        );
        const tasks = await api.decryptTasks(readableEncryptedTasks);
        
        const pendingTasks = await db.getPendingSyncTasks();
        
        const mergedTasks: Task[] = useDelta ? dedupeById(cachedValidTasks) : dedupeById(tasks);
        const serverTaskMap = new Map(tasks.map(t => [t._id, t]));

        for (const serverTask of tasks) {
          const idx = mergedTasks.findIndex((task) => task._id === serverTask._id);
          if (idx !== -1) {
            mergedTasks[idx] = serverTask;
          } else {
            mergedTasks.push(serverTask);
          }
        }
        
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
                    mergedTasks.push(pTask);
                 }
            }
        }

        const deletedTaskIdSet = new Set(deletedTaskIds);
        const nextMergedTasks = dedupeById(mergedTasks).filter((task) => !deletedTaskIdSet.has(task._id));
        const visibleTasks = filterTasksByLockState(nextMergedTasks as any, get().notes, get().unlockedProtectedNoteIds);
        set((state) => ({
          tasks: visibleTasks,
          isLoading: false,
          syncHealth: mergeSyncHealth(state.syncHealth, {
            lastSuccessfulTasksSyncAt: taskChangeSet.serverTime,
            lastHydrationSource: useDelta ? 'remote-delta' : 'remote-full',
          }),
          syncConflicts: clearSyncConflictsForItems(state.syncConflicts, 'task', deletedTaskIds),
        }));
        const taskSyncIndex = typeof db.getTaskSyncIndex === 'function'
          ? await db.getTaskSyncIndex()
          : new Map<string, string>();
        const tasksToPersist = tasks.filter((task) => taskSyncIndex.get(task._id) !== String(task.updatedAt || ''));
        await persistInBatches(tasksToPersist, 50, (task) => db.saveTask(task));
        if (deletedTaskIds.length > 0) {
          await Promise.all(deletedTaskIds.map((taskId) => db.deleteTask(taskId)));
        }
        lastTasksDeltaCursor = taskChangeSet.serverTime;
        if (!useDelta) {
          lastTasksFullSyncAt = Date.now();
        }
        visibleTasks.forEach(scheduleWebReminder);
        markCollectionsRefreshed();
      } catch (error: any) {
        set({ error: error.message, isLoading: false });
      } finally {
        taskFetchPromises.delete(currentFetchKey);
      }
    })();
    taskFetchPromises.set(currentFetchKey, fetchPromise);
    return fetchPromise;
  },

  refreshCollections: async (options) => {
    if (get().isAppLocked) return;
    if (!options?.force && hasRecentCollectionsRefresh()) return;
    if (collectionsRefreshPromise) {
      await collectionsRefreshPromise;
      return;
    }
    const refreshPromise = Promise.all([
      get().fetchNotes(),
      get().fetchTasks(),
    ]).then(() => {
      markCollectionsRefreshed();
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

  selectNote: (id) => {
    const { activeTab } = get();
    set((state) =>
      deriveProtectedVisibilityState(
        state,
        activeTab === 'tasks' ? { selectedTaskListId: id } : { selectedNoteId: id },
      ),
    );
    const nextState = get();
    syncPersistedSelections(nextState.selectedNoteId, nextState.selectedTaskListId);
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

    const { unlockPassword, password: notePassword, ...safeUpdates } = updates as any;
    const currentNote = get().notes.find(n => n._id === id);
    const baseUpdatedAt = typeof updates?.baseUpdatedAt === 'string'
      ? updates.baseUpdatedAt
      : currentNote?.updatedAt;
    const clientMutationId = typeof updates?.clientMutationId === 'string'
      ? updates.clientMutationId
      : getUUID();
    if (typeof unlockPassword === 'string') {
      if (id.startsWith('temp-')) return;
      try {
        const payload: any = { ...safeUpdates, password: notePassword, unlockPassword };
        payload.updatedAt = encrypt(new Date().toISOString());
        payload.baseUpdatedAt = baseUpdatedAt;
        payload.clientMutationId = clientMutationId;
        const updatedNote = await api.updateNote(id, payload);
        set((state) => ({
          ...deriveProtectedVisibilityState(state, {
            notes: state.notes.map((n) => (n._id === id ? updatedNote : n)) as any,
          }),
          syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
        }));
        await db.saveNote(updatedNote, false);
      } catch (error: any) {
        set({ error: error.message });
        try {
          await get().fetchNotes();
        } catch {
        }
      }
      return;
    }

    if (typeof notePassword === 'string' && notePassword.length > 0) {
      if (id.startsWith('temp-')) return;
      try {
        const payload: any = { ...safeUpdates, password: notePassword };
        payload.updatedAt = encrypt(new Date().toISOString());
        payload.baseUpdatedAt = baseUpdatedAt;
        payload.clientMutationId = clientMutationId;
        const updatedNote = await api.updateNote(id, payload);
        set((state) => ({
          ...deriveProtectedVisibilityState(state, {
            notes: state.notes.map((n) => (n._id === id ? updatedNote : n)) as any,
          }),
          syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
        }));
        await db.saveNote(updatedNote, false);
      } catch (error: any) {
        set({ error: error.message });
        try {
          await get().fetchNotes();
        } catch {
        }
      }
      return;
    }

    const stateUpdates = { ...safeUpdates };
    const currentBeforeLock = currentNote as any;
    if (safeUpdates.locked === true) {
        if (currentBeforeLock) {
            stateUpdates.__rawEncryptedTitle = currentBeforeLock.__rawEncryptedTitle || encrypt(currentBeforeLock.title || '');
            stateUpdates.__rawEncryptedContent = currentBeforeLock.__rawEncryptedContent || encrypt(currentBeforeLock.content || '');
            stateUpdates.__rawEncryptedTags = currentBeforeLock.__rawEncryptedTags || (Array.isArray(currentBeforeLock.tags) ? currentBeforeLock.tags.map((t: string) => encrypt(t)) : []);
            stateUpdates.__rawEncryptedIcon = currentBeforeLock.__rawEncryptedIcon || (currentBeforeLock.icon ? encrypt(currentBeforeLock.icon) : undefined);
            stateUpdates.__rawEncryptedIconColor = currentBeforeLock.__rawEncryptedIconColor || (currentBeforeLock.iconColor ? encrypt(currentBeforeLock.iconColor) : undefined);
        }
        stateUpdates.title = i18n.t('note.locked');
        stateUpdates.content = '';
    }

    // Optimistic update
    set((state) => {
      const nextNotes = state.notes.map((n) => {
        if (n._id === id) {
            return {
                ...n,
                ...stateUpdates,
                baseUpdatedAt,
                clientMutationId,
                updatedAt: new Date().toISOString()
            };
        }
        return n;
      });
      const nextUnlocked = safeUpdates.locked === true
        ? state.unlockedProtectedNoteIds.filter((item) => normalizeId(item) !== normalizeId(id))
        : state.unlockedProtectedNoteIds;
      return deriveProtectedVisibilityState(state, {
        notes: nextNotes as any,
        unlockedProtectedNoteIds: nextUnlocked,
      });
    });
    
    // Save to DB (optimistic)
    const optimisticNote = get().notes.find(n => n._id === id);
    if (optimisticNote) {
        await db.saveNote(optimisticNote, true); // Mark pending sync initially
    }

    if (id.startsWith('temp-')) {
      return; // Don't call API for temporary notes
    }

    try {
      const payload: any = { ...safeUpdates };
      payload.updatedAt = encrypt(new Date().toISOString());
      payload.baseUpdatedAt = baseUpdatedAt;
      payload.clientMutationId = clientMutationId;

      const updatedNote = await api.updateNote(id, payload);
      set((state) => ({
        ...deriveProtectedVisibilityState(state, {
          notes: state.notes.map((n) => (n._id === id ? updatedNote : n)) as any,
        }),
        syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'note', id),
      }));
      await db.saveNote(updatedNote, false); // Mark synced
    } catch (error: any) {
      if (isSyncConflictError(error)) {
        const conflictItem = getSyncConflictItem<Note>(error);
        if (conflictItem) {
          const serverNote = materializeNotesFromEncrypted(
            [conflictItem as any],
            new Set(get().unlockedProtectedNoteIds),
          )[0] as Note;
          set((state) => ({
            ...deriveProtectedVisibilityState(state, {
              notes: state.notes.map((n) => (n._id === id ? serverNote : n)) as any,
            }),
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
          await db.saveNote(serverNote, false);
          return;
        }
        set((state) => ({
          error: getSyncConflictMessage('note'),
          syncConflicts: upsertSyncConflict(state.syncConflicts, {
            key: makeSyncConflictKey('note', id),
            entity: 'note',
            itemId: id,
            title: currentNote?.title || id,
            message: getSyncConflictMessage('note'),
            occurredAt: Date.now(),
          }),
        }));
        return;
      }
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
        set((state) => {
          const updatedNotes = state.notes.map((n) => (n._id === id ? { ...n, content, ...(title ? { title } : {}) } : n));
          const nextUnlockIds = Array.from(new Set([...state.unlockedProtectedNoteIds, id, effectiveUnlockId]));
          return deriveProtectedVisibilityState(state, {
            notes: updatedNotes,
            unlockedProtectedNoteIds: nextUnlockIds,
            transientUnlockedProtectedNoteIds: Array.from(new Set([...state.transientUnlockedProtectedNoteIds, id, effectiveUnlockId])),
          });
        });
        try {
          await get().fetchNotes();
          await get().fetchTasks(get().selectedTaskListId ?? undefined);
          const nextState = get();
          syncPersistedSelections(nextState.selectedNoteId, nextState.selectedTaskListId);
          if (nextState.selectedNoteId === id || nextState.activeProjectId === effectiveUnlockId || nextState.activeProjectId === id) {
            get().clearTransientUnlockedProtectedNoteIds();
          }
        } catch (refreshError: any) {
          set({ error: refreshError?.message || null });
        }
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
    const cascadeNoteIds = collectCascadeNoteIds(get().notes, id);
    const cascadeTaskIds = collectTaskIdsForNotes(get().tasks, cascadeNoteIds);
    const tempNoteIds = cascadeNoteIds.filter((noteId) => noteId.startsWith('temp-'));
    const persistedNoteIds = cascadeNoteIds.filter((noteId) => !noteId.startsWith('temp-'));
    const tempTaskIds = cascadeTaskIds.filter((taskId) => taskId.startsWith('temp-'));
    const persistedTaskIds = cascadeTaskIds.filter((taskId) => !taskId.startsWith('temp-'));
    clearReminderTimers(cascadeTaskIds);
    set((state) => ({
      ...deriveCascadeDeletionState(state, cascadeNoteIds, cascadeTaskIds),
      isLoading: false,
      syncConflicts: clearSyncConflictsForItems(
        clearSyncConflictsForItems(state.syncConflicts, 'note', cascadeNoteIds),
        'task',
        cascadeTaskIds,
      ),
    }));

    await Promise.all(tempNoteIds.map((noteId) => db.deleteNote(noteId)));
    await Promise.all(tempTaskIds.map((taskId) => db.deleteTask(taskId)));

    if (id.startsWith('temp-')) {
      return;
    }

    try {
      await api.deleteNote(id);
      await Promise.all(persistedNoteIds.map((noteId) => db.deleteNote(noteId)));
      await Promise.all(persistedTaskIds.map((taskId) => db.deleteTask(taskId)));
    } catch (error: any) {
      await Promise.all(persistedNoteIds.map((noteId) => db.markAsDeleted(noteId)));
      await Promise.all(persistedTaskIds.map((taskId) => db.markTaskAsDeleted(taskId)));
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
      const baseUpdatedAt = typeof (data as any)?.baseUpdatedAt === 'string'
        ? (data as any).baseUpdatedAt
        : previousTask?.updatedAt;
      const clientMutationId = typeof (data as any)?.clientMutationId === 'string'
        ? (data as any).clientMutationId
        : getUUID();
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
          tasks: state.tasks.map(t => t._id === id ? { ...t, ...data, baseUpdatedAt, clientMutationId, updatedAt: new Date().toISOString() } : t)
      }));
      
      const currentTask = get().tasks.find(t => t._id === id);
      if (currentTask) {
          await db.saveTask(currentTask, true); // Mark pending sync
          scheduleWebReminder(currentTask);
      }

      if (id.startsWith('temp-')) return;

      try {
          const updatedTask = await api.updateTask(id, { ...data, baseUpdatedAt, clientMutationId });
          set(state => ({
              tasks: state.tasks.map(t => t._id === id ? updatedTask : t),
              syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', id),
          }));
          await db.saveTask(updatedTask, false);
      } catch (error: any) {
          if (isSyncConflictError(error)) {
              const conflictItem = getSyncConflictItem<Task>(error);
              if (conflictItem) {
                  const [serverTask] = await api.decryptTasks([conflictItem as any]);
                  if (serverTask) {
                      set((state) => ({
                          tasks: filterTasksByLockState(
                              state.tasks.map((t) => (t._id === id ? serverTask : t)),
                              state.notes,
                              state.unlockedProtectedNoteIds,
                          ),
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
                      await db.saveTask(serverTask, false);
                      if (get().tasks.some((task) => task._id === id)) {
                          scheduleWebReminder(serverTask);
                      } else {
                          clearReminderTimer(id);
                      }
                      return;
                  }
              }
              set((state) => ({
                error: getSyncConflictMessage('task'),
                syncConflicts: upsertSyncConflict(state.syncConflicts, {
                  key: makeSyncConflictKey('task', id),
                  entity: 'task',
                  itemId: id,
                  title: previousTask?.title || id,
                  message: getSyncConflictMessage('task'),
                  occurredAt: Date.now(),
                }),
              }));
              return;
          }
          set({ error: error.message });
          // Keep pending sync
      }
  },

  deleteTask: async (id) => {
      // Optimistic
      set(state => ({
          tasks: state.tasks.filter(t => t._id !== id),
          syncConflicts: clearSyncConflictForItem(state.syncConflicts, 'task', id),
      }));
      clearReminderTimer(id);

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

useStore.subscribe((state, prevState) => {
  if (state.syncConflicts === prevState.syncConflicts && state.syncHealth === prevState.syncHealth) {
    return;
  }
  persistSyncMetadata(state.syncConflicts, state.syncHealth);
});
