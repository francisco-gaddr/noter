/**
 * Calendar (ICS) subscription client.
 *
 * Mints a tokenized subscription URL the user can paste into Google/Apple Calendar,
 * and pushes a plaintext projection of their tasks (title + due date) to the backend
 * feed. Task data is E2E-encrypted at rest, so the backend can't build the ICS itself
 * — this is the opt-in bridge that exposes only the minimal calendar fields (which
 * are going to the external calendar anyway). The cached URL/flag is stored locally.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSafeCalendarProjection } from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';

const URL_KEY = 'calendar_subscription_url';
const SUBSCRIBED_KEY = 'calendar_subscribed';

export interface CalendarSubscription {
  url: string;
  token: string;
  count: number;
}

/**
 * Build the projection from the live store, EXCLUDING tasks under locked notes/projects
 * (the locked-notes invariant — a locked task's title must never leave the device, not
 * even via the user's own calendar link). Only title + due date of unlocked, dated tasks.
 */
const safeProjection = () => {
  const s: any = useStore.getState();
  return buildSafeCalendarProjection(s.tasks || [], s.notes || [], s.unlockedProtectedNoteIds || []);
};

/** Create (or fetch existing) subscription and seed it with the current (lock-safe) tasks. */
export const createCalendarSubscription = async (): Promise<CalendarSubscription> => {
  const items = safeProjection();
  // NOTE: fetchWithAuth returns the PARSED JSON body (not a Response) and throws on a
  // non-2xx/timeout. Don't check .ok / call .json() — that's why it failed before.
  const data = (await fetchWithAuth('/calendar/subscription', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })) as CalendarSubscription;
  if (data?.url) await AsyncStorage.multiSet([[URL_KEY, data.url], [SUBSCRIBED_KEY, 'true']]);
  return data;
};

/** Push the latest (lock-safe) projection. No-op if not subscribed. Returns count. */
export const pushCalendarFeed = async (): Promise<number> => {
  if (!(await isCalendarSubscribed())) return 0;
  const items = safeProjection();
  try {
    const data = (await fetchWithAuth('/calendar/feed', {
      method: 'PUT',
      body: JSON.stringify({ items }),
      skipUnauthorized: true,
    })) as { count?: number };
    return data?.count ?? items.length;
  } catch {
    return 0;
  }
};

export const revokeCalendarSubscription = async (): Promise<void> => {
  await fetchWithAuth('/calendar/subscription', { method: 'DELETE' }).catch(() => {});
  await AsyncStorage.multiRemove([URL_KEY, SUBSCRIBED_KEY]);
};

export const getCachedCalendarUrl = async (): Promise<string | null> =>
  AsyncStorage.getItem(URL_KEY);

export const isCalendarSubscribed = async (): Promise<boolean> =>
  (await AsyncStorage.getItem(SUBSCRIBED_KEY)) === 'true';
