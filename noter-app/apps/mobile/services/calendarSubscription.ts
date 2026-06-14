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
import { buildCalendarProjection, type Task } from '@repo/shared';
import { fetchWithAuth } from '@/services/api';

const URL_KEY = 'calendar_subscription_url';
const SUBSCRIBED_KEY = 'calendar_subscribed';

export interface CalendarSubscription {
  url: string;
  token: string;
  count: number;
}

/** Create (or fetch existing) subscription and seed it with the current tasks. */
export const createCalendarSubscription = async (tasks: Task[]): Promise<CalendarSubscription> => {
  const items = buildCalendarProjection(tasks);
  const res = await fetchWithAuth('/calendar/subscription', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Kunde inte skapa kalenderlänk (HTTP ${res.status})`);
  const data = (await res.json()) as CalendarSubscription;
  await AsyncStorage.multiSet([[URL_KEY, data.url], [SUBSCRIBED_KEY, 'true']]);
  return data;
};

/** Push the latest projection (live update). No-op if not subscribed. Returns count. */
export const pushCalendarFeed = async (tasks: Task[]): Promise<number> => {
  if (!(await isCalendarSubscribed())) return 0;
  const items = buildCalendarProjection(tasks);
  const res = await fetchWithAuth('/calendar/feed', {
    method: 'PUT',
    body: JSON.stringify({ items }),
    skipUnauthorized: true,
  });
  if (!res.ok) return 0;
  const data = await res.json().catch(() => ({ count: items.length }));
  return data?.count ?? items.length;
};

export const revokeCalendarSubscription = async (): Promise<void> => {
  await fetchWithAuth('/calendar/subscription', { method: 'DELETE' }).catch(() => {});
  await AsyncStorage.multiRemove([URL_KEY, SUBSCRIBED_KEY]);
};

export const getCachedCalendarUrl = async (): Promise<string | null> =>
  AsyncStorage.getItem(URL_KEY);

export const isCalendarSubscribed = async (): Promise<boolean> =>
  (await AsyncStorage.getItem(SUBSCRIBED_KEY)) === 'true';
