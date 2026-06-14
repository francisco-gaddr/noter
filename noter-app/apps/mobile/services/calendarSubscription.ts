/**
 * Calendar (ICS) subscription client — supports a feed for ALL tasks AND per-task-list
 * feeds. Each scope gets its own tokenized URL. Mints a link the user pastes into
 * Google/Apple Calendar, and pushes a plaintext, lock-safe projection of their tasks
 * (title + due date) for that scope. Task data is E2E-encrypted at rest, so the backend
 * can't build the ICS itself — this opt-in bridge exposes only the minimal calendar
 * fields. The scope→URL map is cached locally.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSafeCalendarProjection, rfcPriorityToTask } from '@repo/shared';
import { fetchWithAuth, API_URL } from '@/services/api';
import { useStore } from '@/stores/useStore';

// scopeKey: 'all' for the all-tasks feed, otherwise the task-list/project note id.
const MAP_KEY = 'calendar_subscriptions_v2';
const LEGACY_URL_KEY = 'calendar_subscription_url';
const LEGACY_FLAG_KEY = 'calendar_subscribed';
const DAV_MAP_KEY = 'calendar_dav_users_v1';

export const ALL_SCOPE = 'all';
export type CalendarScope = string; // 'all' | <listId>

export interface CalendarSubscription { url: string; token?: string; listId: string | null; count?: number }

const scopeKey = (listId?: string | null): string => (!listId || listId === ALL_SCOPE ? ALL_SCOPE : String(listId));

const readMap = async (): Promise<Record<string, string>> => {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch { /* ignore */ }
  // One-time migration from the single-feed v1 cache.
  const legacy = await AsyncStorage.getItem(LEGACY_URL_KEY).catch(() => null);
  return legacy ? { [ALL_SCOPE]: legacy } : {};
};
const writeMap = async (map: Record<string, string>): Promise<void> => {
  await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
};

/** Lock-safe projection from the live store, scoped to a list (or all dated tasks). */
const safeProjection = (listId?: string | null) => {
  const s: any = useStore.getState();
  return buildSafeCalendarProjection(s.tasks || [], s.notes || [], s.unlockedProtectedNoteIds || [], {
    listId: listId && listId !== ALL_SCOPE ? listId : null,
  });
};

/** Create (or fetch) a subscription for a scope and seed it with the current tasks. */
export const createCalendarSubscription = async (listId?: string | null): Promise<CalendarSubscription> => {
  const items = safeProjection(listId);
  // fetchWithAuth returns the PARSED body and throws on non-2xx/timeout (not a Response).
  const data = (await fetchWithAuth('/calendar/subscription', {
    method: 'POST',
    body: JSON.stringify({ items, listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId) }),
  })) as CalendarSubscription;
  if (data?.url) {
    const map = await readMap();
    map[scopeKey(listId)] = data.url;
    await writeMap(map);
  }
  return data;
};

/** Push the latest lock-safe projection to EVERY active subscription (all + each list). */
export const pushCalendarFeed = async (): Promise<number> => {
  const map = await readMap();
  const scopes = Object.keys(map);
  if (scopes.length === 0) return 0;
  let pushed = 0;
  for (const sc of scopes) {
    const items = safeProjection(sc);
    try {
      await fetchWithAuth('/calendar/feed', {
        method: 'PUT',
        body: JSON.stringify({ items, listId: sc === ALL_SCOPE ? null : sc }),
        skipUnauthorized: true,
      });
      pushed += 1;
    } catch { /* best-effort per scope */ }
  }
  return pushed;
};

export const revokeCalendarSubscription = async (listId?: string | null): Promise<void> => {
  const sc = scopeKey(listId);
  await fetchWithAuth('/calendar/subscription', {
    method: 'DELETE',
    body: JSON.stringify({ listId: sc === ALL_SCOPE ? null : sc }),
  }).catch(() => {});
  const map = await readMap();
  delete map[sc];
  await writeMap(map);
  if (sc === ALL_SCOPE) await AsyncStorage.multiRemove([LEGACY_URL_KEY, LEGACY_FLAG_KEY]).catch(() => {});
};

/** Cached scope→URL map (e.g. { all: '…', '<listId>': '…' }). */
export const getCalendarSubscriptions = async (): Promise<Record<string, string>> => readMap();

export const getCalendarUrl = async (listId?: string | null): Promise<string | null> => {
  const map = await readMap();
  return map[scopeKey(listId)] || null;
};

export const isCalendarSubscribed = async (listId?: string | null): Promise<boolean> =>
  Boolean((await readMap())[scopeKey(listId)]);

// ---------------------------------------------------------------------------
// CalDAV (two-way). A revocable Basic-Auth credential per scope; the password is
// returned ONCE. We cache only the username locally for UI status + revoke.
// fetchWithAuth returns the PARSED body and throws on non-2xx (NOT a Response).
// ---------------------------------------------------------------------------

export interface DavCredential {
  listId: string | null;
  username: string;
  password?: string;
  displayName?: string | null;
  serverUrl: string;
  collectionUrl: string;
}

const readDavMap = async (): Promise<Record<string, string>> => {
  try { return JSON.parse((await AsyncStorage.getItem(DAV_MAP_KEY)) || '{}') || {}; } catch { return {}; }
};
const writeDavMap = async (m: Record<string, string>): Promise<void> => {
  await AsyncStorage.setItem(DAV_MAP_KEY, JSON.stringify(m));
};

export const createDavCredential = async (listId?: string | null, displayName?: string): Promise<DavCredential> => {
  const items = safeProjection(listId);
  const data = (await fetchWithAuth('/calendar/dav', {
    method: 'POST',
    body: JSON.stringify({ listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId), displayName, items }),
  })) as DavCredential;
  if (data?.username) {
    const map = await readDavMap();
    map[scopeKey(listId)] = data.username;
    await writeDavMap(map);
  }
  return data;
};

export const revokeDavCredential = async (listId?: string | null): Promise<void> => {
  await fetchWithAuth('/calendar/dav', {
    method: 'DELETE',
    body: JSON.stringify({ listId: scopeKey(listId) === ALL_SCOPE ? null : scopeKey(listId) }),
  }).catch(() => {});
  const map = await readDavMap();
  delete map[scopeKey(listId)];
  await writeDavMap(map);
};

export const getDavUsername = async (listId?: string | null): Promise<string | null> =>
  (await readDavMap())[scopeKey(listId)] || null;
export const hasDavCredential = async (listId?: string | null): Promise<boolean> =>
  Boolean((await readDavMap())[scopeKey(listId)]);

/** The CalDAV server URL the user pastes into Tasks.org / Reminders. */
export const getDavServerUrl = (): string => `${API_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')}/dav/`;

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
    await s.createTask({
      title: d.summary || 'Uppgift',
      parentNoteId: listId || undefined,
      dueDate: d.due ?? null,
      description: d.description || undefined,
      priority: pr || undefined,
      completed: !!d.completed,
      clientId: String(m.uid), // so the widget's later edits to this uid match via clientId
    });
  }
};

/**
 * Drain pending CalDAV write-backs from the widget: apply each with the user's key,
 * ack the applied ids, then re-push the projection. Best-effort; safe on focus/interval.
 */
export const drainCalendarMutations = async (): Promise<number> => {
  let mutations: any[] = [];
  try {
    const body: any = await fetchWithAuth('/calendar/mutations', { method: 'GET', skipUnauthorized: true });
    mutations = Array.isArray(body?.mutations) ? body.mutations : [];
  } catch { return 0; }
  if (mutations.length === 0) return 0;
  const s: any = useStore.getState();
  const applied: string[] = [];
  for (const m of mutations) {
    try { await applyMutation(s, m); applied.push(m.id); } catch { /* retry next drain */ }
  }
  if (applied.length) {
    await fetchWithAuth('/calendar/mutations/ack', {
      method: 'POST', body: JSON.stringify({ ids: applied }), skipUnauthorized: true,
    }).catch(() => {});
    try { await pushCalendarFeed(); } catch { /* ignore */ }
  }
  return applied.length;
};
