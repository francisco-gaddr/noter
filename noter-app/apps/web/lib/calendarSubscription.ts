/**
 * Calendar (ICS) subscription client (web + Electron) — a feed for ALL tasks AND
 * per-task-list feeds, each with its own tokenized URL. Mirrors the mobile service.
 * Task data is E2E-encrypted at rest, so the backend can't build the ICS itself; this
 * opt-in bridge exposes only the minimal calendar fields (title + due date), lock-aware.
 */
import { buildSafeCalendarProjection, rfcPriorityToTask } from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from './authStorage';
import { useStore } from '../stores/useStore';

const MAP_KEY = 'calendar_subscriptions_v2';
const LEGACY_URL_KEY = 'calendar_subscription_url';
const LEGACY_FLAG_KEY = 'calendar_subscribed';
const DAV_MAP_KEY = 'calendar_dav_users_v1';

export const ALL_SCOPE = 'all';

export interface CalendarSubscription { url: string; token?: string; listId: string | null; count?: number }

const scopeKey = (listId?: string | null): string => (!listId || listId === ALL_SCOPE ? ALL_SCOPE : String(listId));

const authHeaders = (): Record<string, string> => {
  const token = (() => { try { return readStoredToken(); } catch { return null; } })();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const readMap = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (raw) return JSON.parse(raw) || {};
    const legacy = localStorage.getItem(LEGACY_URL_KEY);
    return legacy ? { [ALL_SCOPE]: legacy } : {};
  } catch { return {}; }
};
const writeMap = (map: Record<string, string>): void => { try { localStorage.setItem(MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ } };

const safeProjection = (listId?: string | null) => {
  const s: any = useStore.getState();
  return buildSafeCalendarProjection(s.tasks || [], s.notes || [], s.unlockedProtectedNoteIds || [], {
    listId: listId && listId !== ALL_SCOPE ? listId : null,
  });
};

export const createCalendarSubscription = async (listId?: string | null): Promise<CalendarSubscription> => {
  const items = safeProjection(listId);
  const res = await fetch(`${getApiBaseUrl()}/calendar/subscription`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items, listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId) }),
  });
  if (!res.ok) throw new Error(`Kunde inte skapa kalenderlänk (HTTP ${res.status})`);
  const data = (await res.json()) as CalendarSubscription;
  if (data?.url) { const map = readMap(); map[scopeKey(listId)] = data.url; writeMap(map); }
  return data;
};

/** Push the latest lock-safe projection to EVERY active subscription. */
export const pushCalendarFeed = async (): Promise<number> => {
  const map = readMap();
  const scopes = Object.keys(map);
  if (scopes.length === 0) return 0;
  let pushed = 0;
  for (const sc of scopes) {
    const items = safeProjection(sc);
    const res = await fetch(`${getApiBaseUrl()}/calendar/feed`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ items, listId: sc === ALL_SCOPE ? null : sc }),
    }).catch(() => null);
    if (res && res.ok) pushed += 1;
  }
  return pushed;
};

export const revokeCalendarSubscription = async (listId?: string | null): Promise<void> => {
  const sc = scopeKey(listId);
  await fetch(`${getApiBaseUrl()}/calendar/subscription`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ listId: sc === ALL_SCOPE ? null : sc }),
  }).catch(() => {});
  const map = readMap();
  delete map[sc];
  writeMap(map);
  if (sc === ALL_SCOPE) { try { localStorage.removeItem(LEGACY_URL_KEY); localStorage.removeItem(LEGACY_FLAG_KEY); } catch { /* ignore */ } }
};

export const getCalendarSubscriptions = (): Record<string, string> => readMap();
export const getCalendarUrl = (listId?: string | null): string | null => readMap()[scopeKey(listId)] || null;
export const isCalendarSubscribed = (listId?: string | null): boolean => Boolean(readMap()[scopeKey(listId)]);

// ---------------------------------------------------------------------------
// CalDAV (two-way) — a revocable Basic-Auth credential per scope. The password is
// returned ONCE on create; we cache only the username locally so the UI can show
// status + offer revoke. Reads/writes flow through the backend /dav bridge.
// ---------------------------------------------------------------------------

export interface DavCredential {
  listId: string | null;
  username: string;
  password?: string; // present only on creation
  displayName?: string | null;
  serverUrl: string;
  collectionUrl: string;
}

const readDavMap = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DAV_MAP_KEY) || '{}') || {}; } catch { return {}; }
};
const writeDavMap = (m: Record<string, string>): void => { try { localStorage.setItem(DAV_MAP_KEY, JSON.stringify(m)); } catch { /* ignore */ } };

/** Mint (or rotate) a CalDAV credential for a scope. Returns the password ONCE. */
export const createDavCredential = async (listId?: string | null, displayName?: string): Promise<DavCredential> => {
  const items = safeProjection(listId);
  const res = await fetch(`${getApiBaseUrl()}/calendar/dav`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId), displayName, items }),
  });
  if (!res.ok) throw new Error(`Kunde inte aktivera CalDAV (HTTP ${res.status})`);
  const data = (await res.json()) as DavCredential;
  if (data?.username) { const map = readDavMap(); map[scopeKey(listId)] = data.username; writeDavMap(map); }
  return data;
};

/** Revoke a scope's CalDAV credential instantly. */
export const revokeDavCredential = async (listId?: string | null): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/calendar/dav`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId) }),
  }).catch(() => {});
  const map = readDavMap();
  delete map[scopeKey(listId)];
  writeDavMap(map);
};

export const getDavUsername = (listId?: string | null): string | null => readDavMap()[scopeKey(listId)] || null;
export const hasDavCredential = (listId?: string | null): boolean => Boolean(readDavMap()[scopeKey(listId)]);

/** Apply a single queued CalDAV write-back to the real (encrypted) task with the user's key. */
const applyMutation = async (s: any, m: any): Promise<void> => {
  const task = (s.tasks || []).find((t: any) => t._id === m.uid || t.clientId === m.uid);
  if (m.op === 'delete') { if (task) await s.deleteTask(task._id); return; }
  const d = m.data || {};
  if (task) {
    const patch: any = {};
    if (typeof d.completed === 'boolean') patch.completed = d.completed;
    if (typeof d.summary === 'string' && d.summary) patch.title = d.summary;
    if (d.due !== undefined) patch.dueDate = d.due;
    if (typeof d.description === 'string') patch.description = d.description;
    if (typeof d.priority === 'number') { const p = rfcPriorityToTask(d.priority); if (p) patch.priority = p; }
    if (Object.keys(patch).length) await s.updateTask(task._id, patch);
  } else {
    const listId = m.listId && m.listId !== ALL_SCOPE ? m.listId : (m.feedListId && m.feedListId !== ALL_SCOPE ? m.feedListId : undefined);
    const pr = typeof d.priority === 'number' ? rfcPriorityToTask(d.priority) : null;
    await s.createTask(d.summary || 'Uppgift', listId, d.due ?? null, { description: d.description || undefined, priority: pr || undefined });
  }
};

/**
 * Drain pending CalDAV write-backs: fetch the queue, apply each with the user's key,
 * ack the applied ids, then re-push the projection so feeds reflect the new state.
 * Safe to call on focus / interval / after a task sync. Returns #applied.
 */
export const drainCalendarMutations = async (): Promise<number> => {
  const res = await fetch(`${getApiBaseUrl()}/calendar/mutations`, { headers: authHeaders() }).catch(() => null);
  if (!res || !res.ok) return 0;
  const body = await res.json().catch(() => null);
  const mutations = body?.mutations;
  if (!Array.isArray(mutations) || mutations.length === 0) return 0;
  const s: any = useStore.getState();
  const applied: string[] = [];
  for (const m of mutations) {
    try { await applyMutation(s, m); applied.push(m.id); } catch { /* leave un-acked to retry */ }
  }
  if (applied.length) {
    await fetch(`${getApiBaseUrl()}/calendar/mutations/ack`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: applied }),
    }).catch(() => {});
    try { await pushCalendarFeed(); } catch { /* ignore */ }
  }
  return applied.length;
};
