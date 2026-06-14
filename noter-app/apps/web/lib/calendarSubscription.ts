/**
 * Calendar (ICS) subscription client (web + Electron) — a feed for ALL tasks AND
 * per-task-list feeds, each with its own tokenized URL. Mirrors the mobile service.
 * Task data is E2E-encrypted at rest, so the backend can't build the ICS itself; this
 * opt-in bridge exposes only the minimal calendar fields (title + due date), lock-aware.
 */
import { buildSafeCalendarProjection } from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from './authStorage';
import { useStore } from '../stores/useStore';

const MAP_KEY = 'calendar_subscriptions_v2';
const LEGACY_URL_KEY = 'calendar_subscription_url';
const LEGACY_FLAG_KEY = 'calendar_subscribed';

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
