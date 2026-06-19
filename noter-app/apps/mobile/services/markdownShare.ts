/**
 * External Markdown SHARES client (mobile). A share exposes a USER-SELECTED set of
 * notes/project-folders as a Markdown vault reachable over WebDAV (Phase 1) and, when
 * Live mode is on, CRDT (Phase 2). Note bodies are E2E-encrypted, so we push only a
 * lock-aware plaintext PROJECTION (`files`) of the selected notes; inbound external
 * edits arrive as `pendingMutations` we apply with the user's key, then re-push.
 *
 * GOTCHA: fetchWithAuth returns the PARSED body and THROWS on non-2xx — never treat its
 * result as a Response.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildMarkdownVaultProjection,
  parseMarkdownFile,
  buildSecurityNoteMap,
  isReadableForAI,
  normalizeNoteType,
  type VaultNote,
} from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';

const SHARES_CACHE = 'markdown_shares_v1';
const PATHMAP_CACHE = 'markdown_share_paths_v1'; // { [shareId]: { [path]: noteId } } for inbound resolution

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
export interface MintedDavCredential {
  shareId: string; username: string; password: string; serverUrl: string; collectionUrl: string;
}
export interface MintedCrdtToken { shareId: string; token: string; wsUrl: string }

const isValid = (s: any): s is MarkdownShare => !!s && typeof s.shareId === 'string' && s.shareId.length > 0;
const readCache = async (): Promise<MarkdownShare[]> => {
  try { return (JSON.parse((await AsyncStorage.getItem(SHARES_CACHE)) || '[]') || []).filter(isValid); } catch { return []; }
};
const writeCache = async (s: MarkdownShare[]): Promise<void> => {
  await AsyncStorage.setItem(SHARES_CACHE, JSON.stringify((s || []).filter(isValid)));
};
const readPathMap = async (): Promise<Record<string, Record<string, string>>> => {
  try { return JSON.parse((await AsyncStorage.getItem(PATHMAP_CACHE)) || '{}') || {}; } catch { return {}; }
};
const writePathMap = async (m: Record<string, Record<string, string>>): Promise<void> => {
  try { await AsyncStorage.setItem(PATHMAP_CACHE, JSON.stringify(m)); } catch { /* best-effort */ }
};

/** Lock-aware projection of a share's scope; also persists the path→noteId map. */
const projectionFor = async (share: { shareId: string; folderIds: string[]; noteIds: string[] }) => {
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
  // Remember path→noteId so inbound deletes/renames can resolve a file to its note.
  const map = await readPathMap();
  map[share.shareId] = Object.fromEntries(files.map((f) => [f.path, f.noteId]));
  await writePathMap(map);
  return files;
};

export const getCachedMarkdownShares = async (): Promise<MarkdownShare[]> => readCache();

/** shareId of a Live (CRDT) share containing this note, or null (used by the live connector). */
export const liveShareIdForNote = async (noteId: string): Promise<string | null> => {
  const map = await readPathMap();
  for (const s of await readCache()) {
    if (!s.modes?.crdt || !s.crdt?.enabled) continue;
    if (Object.values(map[s.shareId] || {}).includes(noteId)) return s.shareId;
  }
  return null;
};

export const refreshMarkdownShares = async (): Promise<MarkdownShare[]> => {
  try {
    const body: any = await fetchWithAuth('/markdown/shares', { method: 'GET', skipUnauthorized: true });
    const shares: MarkdownShare[] = Array.isArray(body?.shares) ? body.shares : [];
    await writeCache(shares);
    return shares;
  } catch { return readCache(); }
};

export const createMarkdownShare = async (input: {
  name: string; folderIds?: string[]; noteIds?: string[]; modes?: any; direction?: any;
}): Promise<MarkdownShare> => {
  const files = await projectionFor({ shareId: 'pending', folderIds: input.folderIds || [], noteIds: input.noteIds || [] });
  const share = (await fetchWithAuth('/markdown/shares', {
    method: 'POST',
    body: JSON.stringify({ ...input, files }),
  })) as MarkdownShare;
  const cache = (await readCache()).filter((s) => s.shareId !== share.shareId);
  await writeCache([...cache, share]);
  // Re-key the path map under the real shareId + push the projection.
  await pushMarkdownShare(share.shareId);
  return share;
};

export const updateMarkdownShare = async (shareId: string, patch: {
  name?: string; folderIds?: string[]; noteIds?: string[]; modes?: any; direction?: any;
}): Promise<MarkdownShare> => {
  const cache = await readCache();
  const cur = cache.find((s) => s.shareId === shareId);
  const folderIds = patch.folderIds ?? cur?.folderIds ?? [];
  const noteIds = patch.noteIds ?? cur?.noteIds ?? [];
  const files = await projectionFor({ shareId, folderIds, noteIds });
  const share = (await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}`, {
    method: 'PUT', body: JSON.stringify({ ...patch, files }),
  })) as MarkdownShare;
  await writeCache(cache.map((s) => (s.shareId === shareId ? share : s)));
  return share;
};

export const deleteMarkdownShare = async (shareId: string): Promise<void> => {
  await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }).catch(() => {});
  await writeCache((await readCache()).filter((s) => s.shareId !== shareId));
  const map = await readPathMap(); delete map[shareId]; await writePathMap(map);
};

export const mintMarkdownDav = async (shareId: string): Promise<MintedDavCredential> => {
  const cred = (await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}/dav`, { method: 'POST', body: '{}' })) as MintedDavCredential;
  await refreshMarkdownShares();
  return cred;
};
export const revokeMarkdownDav = async (shareId: string): Promise<void> => {
  await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}/dav`, { method: 'DELETE' }).catch(() => {});
  await refreshMarkdownShares();
};
export const mintMarkdownCrdt = async (shareId: string): Promise<MintedCrdtToken> => {
  const tok = (await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}/crdt`, { method: 'POST', body: '{}' })) as MintedCrdtToken;
  await refreshMarkdownShares();
  return tok;
};
export const revokeMarkdownCrdt = async (shareId: string): Promise<void> => {
  await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}/crdt`, { method: 'DELETE' }).catch(() => {});
  await refreshMarkdownShares();
};

/** Push the latest lock-safe projection for one share (outbound-enabled only). */
export const pushMarkdownShare = async (shareId: string): Promise<boolean> => {
  const share = (await readCache()).find((s) => s.shareId === shareId);
  if (!share) return false;
  try {
    const files = await projectionFor(share);
    await fetchWithAuth(`/markdown/shares/${encodeURIComponent(shareId)}`, {
      method: 'PUT', body: JSON.stringify({ files }), skipUnauthorized: true,
    });
    return true;
  } catch { return false; }
};

/** Push every share's projection (called after a note change). */
export const pushAllMarkdownShares = async (): Promise<number> => {
  const shares = await readCache();
  let n = 0;
  for (const sh of shares) { if (await pushMarkdownShare(sh.shareId)) n += 1; }
  return n;
};

const baseName = (p: string): string => (p.split('/').pop() || '').replace(/\.(md|markdown)$/i, '');

const applyMutation = async (m: any, pathMap: Record<string, Record<string, string>>): Promise<void> => {
  const s: any = useStore.getState();
  const shareMap = pathMap[m.shareId] || {};
  const share = (await readCache()).find((x) => x.shareId === m.shareId);
  if (share && !share.direction?.inbound) return; // inbound disabled → ignore external writes

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
  // upsert
  const parsed = parseMarkdownFile(String(m.body || ''));
  const noteId = parsed.id || shareMap[m.path];
  const title = (parsed.title || baseName(m.path)).slice(0, 500);
  const content = parsed.body;
  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
  if (noteId && (s.notes || []).some((n: any) => n._id === noteId)) {
    await s.updateNote(noteId, { title, content, ...(tags.length ? { tags } : {}) });
  } else {
    // Brand-new external note: drop it into the share's first folder (if any), else root.
    const parentId = share?.folderIds?.[0] || null;
    await s.createNote({ title, content, tags, parentId, type: 'note' } as any);
  }
};

/** Drain inbound WebDAV write-backs and apply them with the user's key, then re-push. */
export const drainMarkdownMutations = async (): Promise<number> => {
  let mutations: any[] = [];
  try {
    const body: any = await fetchWithAuth('/markdown/mutations', { method: 'GET', skipUnauthorized: true });
    mutations = Array.isArray(body?.mutations) ? body.mutations : [];
  } catch { return 0; }
  if (mutations.length === 0) return 0;
  const pathMap = await readPathMap();
  const applied: string[] = [];
  for (const m of mutations) {
    try { await applyMutation(m, pathMap); applied.push(m.id); }
    catch { /* leave un-acked for retry */ }
  }
  if (applied.length) {
    await fetchWithAuth('/markdown/mutations/ack', { method: 'POST', body: JSON.stringify({ ids: applied }) }).catch(() => {});
    await pushAllMarkdownShares().catch(() => {}); // reflect the applied state outward
  }
  return applied.length;
};

/** One-shot full reconcile: refresh shares, push projections, drain inbound. */
export const syncMarkdownShares = async (): Promise<void> => {
  await refreshMarkdownShares().catch(() => {});
  await pushAllMarkdownShares().catch(() => {});
  await drainMarkdownMutations().catch(() => {});
};
