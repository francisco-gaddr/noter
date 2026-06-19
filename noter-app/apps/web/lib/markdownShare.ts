/**
 * External Markdown SHARES client (web + Electron). A share exposes a USER-SELECTED set
 * of notes/project-folders as a Markdown vault over WebDAV (Phase 1) + CRDT (Phase 2).
 * Note bodies are E2E-encrypted, so we push only a lock-aware plaintext PROJECTION
 * (`files`); inbound external edits arrive as `pendingMutations` we apply with the user's
 * key, then re-push. The note/files twin of calendarSubscription.ts.
 */
import {
  buildMarkdownVaultProjection,
  parseMarkdownFile,
  buildSecurityNoteMap,
  isReadableForAI,
  normalizeNoteType,
  createAppliedLedger,
  applyMutationsOnce,
  type VaultNote,
} from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from './authStorage';
import { useStore } from '../stores/useStore';

const SHARES_CACHE = 'markdown_shares_v1';
const PATHMAP_CACHE = 'markdown_share_paths_v1';

export interface MarkdownShare {
  shareId: string;
  name: string;
  folderIds: string[];
  noteIds: string[];
  modes: { webdav: boolean; crdt: boolean };
  direction: { outbound: boolean; inbound: boolean };
  count?: number;
  dav: { username: string; serverUrl: string; collectionUrl: string; lastSeenAt?: string | null } | null;
  crdt: { enabled: boolean; wsUrl: string } | null;
}
export interface MintedDavCredential { shareId: string; username: string; password: string; serverUrl: string; collectionUrl: string }
export interface MintedCrdtToken { shareId: string; token: string; wsUrl: string }

const authHeaders = (): Record<string, string> => {
  const token = (() => { try { return readStoredToken(); } catch { return null; } })();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const isValid = (s: any): s is MarkdownShare => !!s && typeof s.shareId === 'string' && s.shareId.length > 0;
const readCache = (): MarkdownShare[] => {
  try { return (JSON.parse(localStorage.getItem(SHARES_CACHE) || '[]') || []).filter(isValid); } catch { return []; }
};
const writeCache = (s: MarkdownShare[]): void => {
  try { localStorage.setItem(SHARES_CACHE, JSON.stringify((s || []).filter(isValid))); } catch { /* ignore */ }
};
const readPathMap = (): Record<string, Record<string, string>> => {
  try { return JSON.parse(localStorage.getItem(PATHMAP_CACHE) || '{}') || {}; } catch { return {}; }
};
const writePathMap = (m: Record<string, Record<string, string>>): void => {
  try { localStorage.setItem(PATHMAP_CACHE, JSON.stringify(m)); } catch { /* ignore */ }
};

const projectionFor = (share: { shareId: string; folderIds: string[]; noteIds: string[] }) => {
  const s: any = useStore.getState();
  const notes: VaultNote[] = (s.notes || []) as VaultNote[];
  const noteMap = buildSecurityNoteMap(notes as any);
  // SECURITY: a published markdown share is served over WebDAV WITHOUT any unlock session, so
  // lock-check with the EMPTY unlock set (isReadableForAI) — a locked note (even one open in
  // the UI) must never be projected into the share.
  const files = buildMarkdownVaultProjection(notes, {
    folderIds: share.folderIds || [],
    noteIds: share.noteIds || [],
    isProject: (n) => normalizeNoteType((n as any).type) === 'project',
    isLocked: (n) => !isReadableForAI(n as any, noteMap as any),
  });
  const map = readPathMap();
  map[share.shareId] = Object.fromEntries(files.map((f) => [f.path, f.noteId]));
  writePathMap(map);
  return files;
};

export const getCachedMarkdownShares = (): MarkdownShare[] => readCache();

/** The shareId of a Live (CRDT) share that contains this note, or null. Used by the
 *  live connector to know whether a note is real-time editable + which room to join. */
export const liveShareIdForNote = (noteId: string): string | null => {
  const map = readPathMap();
  for (const s of readCache()) {
    if (!s.modes?.crdt || !s.crdt?.enabled) continue;
    if (Object.values(map[s.shareId] || {}).includes(noteId)) return s.shareId;
  }
  return null;
};

export const refreshMarkdownShares = async (): Promise<MarkdownShare[]> => {
  const res = await fetch(`${getApiBaseUrl()}/markdown/shares`, { headers: authHeaders() }).catch(() => null);
  if (!res || !res.ok) return readCache();
  const data = await res.json().catch(() => null);
  const shares: MarkdownShare[] = Array.isArray(data?.shares) ? data.shares : [];
  writeCache(shares);
  return shares;
};

export const createMarkdownShare = async (input: { name: string; folderIds?: string[]; noteIds?: string[]; modes?: any; direction?: any }): Promise<MarkdownShare> => {
  const files = projectionFor({ shareId: 'pending', folderIds: input.folderIds || [], noteIds: input.noteIds || [] });
  const res = await fetch(`${getApiBaseUrl()}/markdown/shares`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ...input, files }) });
  if (!res.ok) throw new Error(`Kunde inte skapa Markdown-delning (HTTP ${res.status})`);
  const share = (await res.json()) as MarkdownShare;
  writeCache([...readCache().filter((s) => s.shareId !== share.shareId), share]);
  await pushMarkdownShare(share.shareId);
  return share;
};

export const updateMarkdownShare = async (shareId: string, patch: { name?: string; folderIds?: string[]; noteIds?: string[]; modes?: any; direction?: any }): Promise<MarkdownShare> => {
  const cur = readCache().find((s) => s.shareId === shareId);
  const folderIds = patch.folderIds ?? cur?.folderIds ?? [];
  const noteIds = patch.noteIds ?? cur?.noteIds ?? [];
  const files = projectionFor({ shareId, folderIds, noteIds });
  const res = await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...patch, files }) });
  if (!res.ok) throw new Error(`Kunde inte uppdatera delning (HTTP ${res.status})`);
  const share = (await res.json()) as MarkdownShare;
  writeCache(readCache().map((s) => (s.shareId === shareId ? share : s)));
  return share;
};

export const deleteMarkdownShare = async (shareId: string): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  writeCache(readCache().filter((s) => s.shareId !== shareId));
  const map = readPathMap(); delete map[shareId]; writePathMap(map);
};

export const mintMarkdownDav = async (shareId: string): Promise<MintedDavCredential> => {
  const res = await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}/dav`, { method: 'POST', headers: authHeaders(), body: '{}' });
  if (!res.ok) throw new Error(`Kunde inte skapa WebDAV-lösenord (HTTP ${res.status})`);
  const cred = (await res.json()) as MintedDavCredential;
  await refreshMarkdownShares();
  return cred;
};
export const revokeMarkdownDav = async (shareId: string): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}/dav`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  await refreshMarkdownShares();
};
export const mintMarkdownCrdt = async (shareId: string): Promise<MintedCrdtToken> => {
  const res = await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}/crdt`, { method: 'POST', headers: authHeaders(), body: '{}' });
  if (!res.ok) throw new Error(`Kunde inte aktivera Live-läge (HTTP ${res.status})`);
  const tok = (await res.json()) as MintedCrdtToken;
  await refreshMarkdownShares();
  return tok;
};
export const revokeMarkdownCrdt = async (shareId: string): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}/crdt`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  await refreshMarkdownShares();
};

export const pushMarkdownShare = async (shareId: string): Promise<boolean> => {
  const share = readCache().find((s) => s.shareId === shareId);
  if (!share) return false;
  try {
    const files = projectionFor(share);
    const res = await fetch(`${getApiBaseUrl()}/markdown/shares/${encodeURIComponent(shareId)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ files }) });
    return !!res?.ok;
  } catch { return false; }
};

export const pushAllMarkdownShares = async (): Promise<number> => {
  let n = 0;
  for (const sh of readCache()) { if (await pushMarkdownShare(sh.shareId)) n += 1; }
  return n;
};

const baseName = (p: string): string => (p.split('/').pop() || '').replace(/\.(md|markdown)$/i, '');

const applyMutation = async (m: any, pathMap: Record<string, Record<string, string>>): Promise<void> => {
  const s: any = useStore.getState();
  const shareMap = pathMap[m.shareId] || {};
  const share = readCache().find((x) => x.shareId === m.shareId);
  if (share && !share.direction?.inbound) return;

  if (m.op === 'delete') {
    const noteId = shareMap[m.path];
    if (noteId && (s.notes || []).some((n: any) => n._id === noteId)) await s.deleteNote(noteId);
    return;
  }
  if (m.op === 'move') {
    const noteId = shareMap[m.path];
    if (noteId && m.destination) await s.updateNote(noteId, { title: baseName(String(m.destination)) });
    return;
  }
  const parsed = parseMarkdownFile(String(m.body || ''));
  const noteId = parsed.id || shareMap[m.path];
  const title = (parsed.title || baseName(m.path)).slice(0, 500);
  const content = parsed.body;
  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
  if (noteId && (s.notes || []).some((n: any) => n._id === noteId)) {
    await s.updateNote(noteId, { title, content, ...(tags.length ? { tags } : {}) });
  } else {
    const parentId = share?.folderIds?.[0] || null;
    await s.createNote(title, parentId, 'note');
    // web createNote doesn't return the id or take content — set body on the new note.
    const created = [...(useStore.getState().notes || [])].reverse().find((n: any) => n.title === title);
    if (created && (content || tags.length)) await s.updateNote(created._id, { content, ...(tags.length ? { tags } : {}) });
  }
};

// Idempotency ledger: a redelivered mutation is re-acked but NOT re-applied (no duplicate
// note creation on a lost ACK / reconnect). See @repo/shared/mutationLedger.
const markdownMutationLedger = createAppliedLedger();

export const drainMarkdownMutations = async (): Promise<number> => {
  const res = await fetch(`${getApiBaseUrl()}/markdown/mutations`, { headers: authHeaders() }).catch(() => null);
  if (!res || !res.ok) return 0;
  const data = await res.json().catch(() => null);
  const mutations: any[] = Array.isArray(data?.mutations) ? data.mutations : [];
  if (mutations.length === 0) return 0;
  const pathMap = readPathMap();
  const applied = await applyMutationsOnce(mutations, markdownMutationLedger, (m) => applyMutation(m, pathMap));
  if (applied.length) {
    await fetch(`${getApiBaseUrl()}/markdown/mutations/ack`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: applied }) }).catch(() => {});
    await pushAllMarkdownShares().catch(() => {});
  }
  return applied.length;
};

export const syncMarkdownShares = async (): Promise<void> => {
  await refreshMarkdownShares().catch(() => {});
  await pushAllMarkdownShares().catch(() => {});
  await drainMarkdownMutations().catch(() => {});
};
