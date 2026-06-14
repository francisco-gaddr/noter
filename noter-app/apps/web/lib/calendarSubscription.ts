/**
 * Calendar/CalDAV SHARES client (web + Electron). A "delning" (share) is a named
 * collection covering a SET of task-lists (or all), exposed under one ICS link + one
 * CalDAV login. Managed in Settings. Task data is E2E-encrypted, so we push only a
 * minimal, lock-aware plaintext projection (the union of the share's lists).
 */
import { buildSafeCalendarProjection, rfcPriorityToTask } from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from './authStorage';
import { useStore } from '../stores/useStore';

const SHARES_CACHE = 'calendar_shares_v1';

export interface Share {
  shareId: string;
  name: string;
  listIds: string[];
  icsUrl: string;
  count?: number;
  dav: { username: string; serverUrl: string; collectionUrl: string; lastSeenAt?: string | null } | null;
}
export interface MintedDavCredential {
  shareId: string;
  username: string;
  password: string; // shown once
  serverUrl: string;
  collectionUrl: string;
}

const authHeaders = (): Record<string, string> => {
  const token = (() => { try { return readStoredToken(); } catch { return null; } })();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const readCache = (): Share[] => { try { return JSON.parse(localStorage.getItem(SHARES_CACHE) || '[]') || []; } catch { return []; } };
const writeCache = (s: Share[]): void => { try { localStorage.setItem(SHARES_CACHE, JSON.stringify(s)); } catch { /* ignore */ } };

/** Lock-safe projection for a share's set of lists (empty = all tasks). */
const projectionFor = (listIds: string[]) => {
  const s: any = useStore.getState();
  return buildSafeCalendarProjection(s.tasks || [], s.notes || [], s.unlockedProtectedNoteIds || [], { listIds: listIds || [] });
};

export const getCachedShares = (): Share[] => readCache();

/** Fetch the user's shares from the backend (source of truth) + refresh the cache. */
export const refreshShares = async (): Promise<Share[]> => {
  const res = await fetch(`${getApiBaseUrl()}/calendar/shares`, { headers: authHeaders() }).catch(() => null);
  if (!res || !res.ok) return readCache();
  const data = await res.json().catch(() => null);
  const shares: Share[] = Array.isArray(data?.shares) ? data.shares : [];
  writeCache(shares);
  return shares;
};

export const createShare = async (name: string, listIds: string[]): Promise<Share> => {
  const res = await fetch(`${getApiBaseUrl()}/calendar/shares`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ name, listIds, items: projectionFor(listIds) }),
  });
  if (!res.ok) throw new Error(`Kunde inte skapa delning (HTTP ${res.status})`);
  const share = (await res.json()) as Share;
  writeCache([...readCache().filter((s) => s.shareId !== share.shareId), share]);
  return share;
};

export const updateShare = async (shareId: string, patch: { name?: string; listIds?: string[] }): Promise<Share> => {
  const listIds = patch.listIds ?? readCache().find((s) => s.shareId === shareId)?.listIds ?? [];
  const res = await fetch(`${getApiBaseUrl()}/calendar/shares/${encodeURIComponent(shareId)}`, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ ...patch, items: projectionFor(listIds) }),
  });
  if (!res.ok) throw new Error(`Kunde inte uppdatera delning (HTTP ${res.status})`);
  const share = (await res.json()) as Share;
  writeCache(readCache().map((s) => (s.shareId === shareId ? share : s)));
  return share;
};

export const deleteShare = async (shareId: string): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/calendar/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  writeCache(readCache().filter((s) => s.shareId !== shareId));
};

export const mintShareDav = async (shareId: string): Promise<MintedDavCredential> => {
  const res = await fetch(`${getApiBaseUrl()}/calendar/shares/${encodeURIComponent(shareId)}/dav`, { method: 'POST', headers: authHeaders(), body: '{}' });
  if (!res.ok) throw new Error(`Kunde inte aktivera CalDAV (HTTP ${res.status})`);
  const cred = (await res.json()) as MintedDavCredential;
  await refreshShares();
  return cred;
};

export const revokeShareDav = async (shareId: string): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/calendar/shares/${encodeURIComponent(shareId)}/dav`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  await refreshShares();
};

/** Push the latest lock-safe projection to EVERY share (debounced caller). */
export const pushCalendarFeed = async (): Promise<number> => {
  const shares = readCache();
  if (shares.length === 0) return 0;
  let pushed = 0;
  for (const sh of shares) {
    const res = await fetch(`${getApiBaseUrl()}/calendar/shares/${encodeURIComponent(sh.shareId)}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ items: projectionFor(sh.listIds) }),
    }).catch(() => null);
    if (res && res.ok) pushed += 1;
  }
  return pushed;
};

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
    // Widget-created task: drop it into the share's list only when unambiguous (1 list).
    const share = readCache().find((x) => x.shareId === m.shareId);
    const listId = share && share.listIds.length === 1 ? share.listIds[0] : undefined;
    const pr = typeof d.priority === 'number' ? rfcPriorityToTask(d.priority) : null;
    await s.createTask(d.summary || 'Uppgift', listId, d.due ?? null, { description: d.description || undefined, priority: pr || undefined });
  }
};

/** Drain pending CalDAV write-backs, apply with the user's key, ack, re-push. */
export const drainCalendarMutations = async (): Promise<number> => {
  const res = await fetch(`${getApiBaseUrl()}/calendar/mutations`, { headers: authHeaders() }).catch(() => null);
  if (!res || !res.ok) return 0;
  const body = await res.json().catch(() => null);
  const mutations = body?.mutations;
  if (!Array.isArray(mutations) || mutations.length === 0) return 0;
  const s: any = useStore.getState();
  const applied: string[] = [];
  for (const m of mutations) {
    try { await applyMutation(s, m); applied.push(m.id); } catch { /* leave un-acked */ }
  }
  if (applied.length) {
    await fetch(`${getApiBaseUrl()}/calendar/mutations/ack`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: applied }) }).catch(() => {});
    try { await pushCalendarFeed(); } catch { /* ignore */ }
  }
  return applied.length;
};
