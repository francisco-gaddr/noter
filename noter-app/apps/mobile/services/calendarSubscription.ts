/**
 * Calendar (ICS) subscription client — supports a feed for ALL tasks AND per-task-list
 * feeds. Each scope gets its own tokenized URL. Mints a link the user pastes into
 * Google/Apple Calendar, and pushes a plaintext, lock-safe projection of their tasks
 * (title + due date) for that scope. Task data is E2E-encrypted at rest, so the backend
 * can't build the ICS itself — this opt-in bridge exposes only the minimal calendar
 * fields. The scope→URL map is cached locally.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSafeCalendarProjection } from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';

// scopeKey: 'all' for the all-tasks feed, otherwise the task-list/project note id.
const MAP_KEY = 'calendar_subscriptions_v2';
const LEGACY_URL_KEY = 'calendar_subscription_url';
const LEGACY_FLAG_KEY = 'calendar_subscribed';

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
