/**
 * Calendar/CalDAV SHARES client (mobile). A "delning" (share) covers a SET of
 * task-lists (or all) under one ICS link + one CalDAV login, managed in Settings.
 * Task data is E2E-encrypted, so we push only a minimal, lock-aware plaintext
 * projection (the union of the share's lists).
 *
 * GOTCHA: fetchWithAuth returns the PARSED body and THROWS on non-2xx/timeout — it is
 * NOT a Response. Never check .ok / call .json() on its result.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSafeCalendarProjection, rfcPriorityToTask, createAppliedLedger, applyMutationsOnce } from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';

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
  password: string;
  serverUrl: string;
  collectionUrl: string;
}

// Only trust shares with a real shareId — a legacy/corrupt cache entry without one
// would make pushCalendarFeed PUT to `/shares/undefined` → 404. Prune on read/write.
const isValidShare = (s: any): s is Share => !!s && typeof s.shareId === 'string' && s.shareId.length > 0;
const readCache = async (): Promise<Share[]> => {
  try { return (JSON.parse((await AsyncStorage.getItem(SHARES_CACHE)) || '[]') || []).filter(isValidShare); } catch { return []; }
};
const writeCache = async (s: Share[]): Promise<void> => { await AsyncStorage.setItem(SHARES_CACHE, JSON.stringify((s || []).filter(isValidShare))); };

const projectionFor = (listIds: string[]) => {
  const s: any = useStore.getState();
  // SECURITY: empty unlock set — the published ICS/CalDAV feed is served without an unlock
  // session, so a locked list (even one open in the UI) must never reach it.
  return buildSafeCalendarProjection(s.tasks || [], s.notes || [], [], { listIds: listIds || [] });
};

export const getCachedShares = async (): Promise<Share[]> => readCache();

export const refreshShares = async (): Promise<Share[]> => {
  try {
    const body: any = await fetchWithAuth('/calendar/shares', { method: 'GET', skipUnauthorized: true });
    const shares: Share[] = Array.isArray(body?.shares) ? body.shares : [];
    await writeCache(shares);
    return shares;
  } catch {
    return readCache();
  }
};

export const createShare = async (name: string, listIds: string[]): Promise<Share> => {
  const share = (await fetchWithAuth('/calendar/shares', {
    method: 'POST', body: JSON.stringify({ name, listIds, items: projectionFor(listIds) }),
  })) as Share;
  const cache = (await readCache()).filter((s) => s.shareId !== share.shareId);
  await writeCache([...cache, share]);
  return share;
};

export const updateShare = async (shareId: string, patch: { name?: string; listIds?: string[] }): Promise<Share> => {
  const cache = await readCache();
  const listIds = patch.listIds ?? cache.find((s) => s.shareId === shareId)?.listIds ?? [];
  const share = (await fetchWithAuth(`/calendar/shares/${encodeURIComponent(shareId)}`, {
    method: 'PUT', body: JSON.stringify({ ...patch, items: projectionFor(listIds) }),
  })) as Share;
  await writeCache(cache.map((s) => (s.shareId === shareId ? share : s)));
  return share;
};

export const deleteShare = async (shareId: string): Promise<void> => {
  await fetchWithAuth(`/calendar/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }).catch(() => {});
  await writeCache((await readCache()).filter((s) => s.shareId !== shareId));
};

export const mintShareDav = async (shareId: string): Promise<MintedDavCredential> => {
  const cred = (await fetchWithAuth(`/calendar/shares/${encodeURIComponent(shareId)}/dav`, { method: 'POST', body: '{}' })) as MintedDavCredential;
  await refreshShares();
  return cred;
};

export const revokeShareDav = async (shareId: string): Promise<void> => {
  await fetchWithAuth(`/calendar/shares/${encodeURIComponent(shareId)}/dav`, { method: 'DELETE' }).catch(() => {});
  await refreshShares();
};

/** Push the latest lock-safe projection to EVERY share. */
export const pushCalendarFeed = async (): Promise<number> => {
  const shares = await readCache();
  if (shares.length === 0) return 0;
  let pushed = 0;
  for (const sh of shares) {
    try {
      await fetchWithAuth(`/calendar/shares/${encodeURIComponent(sh.shareId)}`, {
        method: 'PUT', body: JSON.stringify({ items: projectionFor(sh.listIds) }), skipUnauthorized: true,
      });
      pushed += 1;
    } catch { /* best-effort per share */ }
  }
  return pushed;
};

const applyMutation = async (s: any, m: any, shares: Share[]): Promise<void> => {
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
    // Defence-in-depth against the empty-"Uppgift" spam: never CREATE a task from a
    // mutation that has no real title (backend already drops these, but an old queued
    // mutation could still arrive). Updates above keep an existing title untouched.
    const title = (typeof d.summary === 'string' ? d.summary : '').trim();
    if (!title) return;
    const share = shares.find((x) => x.shareId === m.shareId);
    const listId = share && share.listIds.length === 1 ? share.listIds[0] : undefined;
    const pr = typeof d.priority === 'number' ? rfcPriorityToTask(d.priority) : null;
    await s.createTask({
      title,
      parentNoteId: listId || undefined,
      dueDate: d.due ?? null,
      description: d.description || undefined,
      priority: pr || undefined,
      completed: !!d.completed,
      clientId: String(m.uid),
    });
  }
};

// Idempotency ledger: a redelivered mutation is re-acked but NOT re-applied (no duplicate task on a
// lost ACK / reconnect). See @repo/shared/mutationLedger.
const calendarMutationLedger = createAppliedLedger();

export const drainCalendarMutations = async (): Promise<number> => {
  let mutations: any[] = [];
  try {
    const body: any = await fetchWithAuth('/calendar/mutations', { method: 'GET', skipUnauthorized: true });
    mutations = Array.isArray(body?.mutations) ? body.mutations : [];
  } catch { return 0; }
  if (mutations.length === 0) return 0;
  const s: any = useStore.getState();
  const shares = await readCache();
  const applied = await applyMutationsOnce(mutations, calendarMutationLedger, (m) => applyMutation(s, m, shares));
  if (applied.length) {
    await fetchWithAuth('/calendar/mutations/ack', { method: 'POST', body: JSON.stringify({ ids: applied }), skipUnauthorized: true }).catch(() => {});
    try { await pushCalendarFeed(); } catch { /* ignore */ }
  }
  return applied.length;
};
