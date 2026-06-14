/**
 * Calendar (ICS) subscription client (web + Electron).
 *
 * Mirrors the mobile service: mints a tokenized subscription URL to paste into
 * Google/Apple Calendar and pushes a plaintext projection of the user's tasks
 * (title + due date) to the backend feed. Task data is E2E-encrypted at rest, so
 * the backend can't build the ICS itself — this opt-in bridge exposes only the
 * minimal calendar fields. The cached URL/flag lives in localStorage.
 */
import { buildCalendarProjection, type Task } from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from './authStorage';

const URL_KEY = 'calendar_subscription_url';
const SUBSCRIBED_KEY = 'calendar_subscribed';

export interface CalendarSubscription {
  url: string;
  token: string;
  count: number;
}

const authHeaders = (): Record<string, string> => {
  const token = (() => { try { return readStoredToken(); } catch { return null; } })();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const lsDel = (k: string): void => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export const createCalendarSubscription = async (tasks: Task[]): Promise<CalendarSubscription> => {
  const items = buildCalendarProjection(tasks);
  const res = await fetch(`${getApiBaseUrl()}/calendar/subscription`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Kunde inte skapa kalenderlänk (HTTP ${res.status})`);
  const data = (await res.json()) as CalendarSubscription;
  lsSet(URL_KEY, data.url);
  lsSet(SUBSCRIBED_KEY, 'true');
  return data;
};

export const pushCalendarFeed = async (tasks: Task[]): Promise<number> => {
  if (!isCalendarSubscribed()) return 0;
  const items = buildCalendarProjection(tasks);
  const res = await fetch(`${getApiBaseUrl()}/calendar/feed`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ items }),
  }).catch(() => null);
  if (!res || !res.ok) return 0;
  const data = await res.json().catch(() => ({ count: items.length }));
  return data?.count ?? items.length;
};

export const revokeCalendarSubscription = async (): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/calendar/subscription`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  lsDel(URL_KEY);
  lsDel(SUBSCRIBED_KEY);
};

export const getCachedCalendarUrl = (): string | null => lsGet(URL_KEY);
export const isCalendarSubscribed = (): boolean => lsGet(SUBSCRIBED_KEY) === 'true';
