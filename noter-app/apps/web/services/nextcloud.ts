/**
 * Nextcloud (WebDAV) INBOUND ingestion — web/Electron service (parity with the mobile
 * service). The app acts as a WebDAV CLIENT, pulls the user-selected folders, and lands each
 * file as an E2E-encrypted Note (api.createNote encrypts with the user's key before sending).
 * PDF text is extracted client-side via pdfText.ts (web/Electron); text files inline directly.
 *
 * SECURITY: the Nextcloud app-password is stored encrypted in localStorage (never sent to the
 * Noter backend). TLS is enforced; PROPFIND is hard-scoped under the selected roots. The Neo4j
 * sync uses the shared lock-safe selection (locked subtree never mirrored) and pushes
 * parameterized Cypher to the backend relay. See Doc/nextcloud-ingestion.md.
 */
import {
  buildPropfindBody,
  parsePropfindXml,
  classifyFile,
  enforceHttps,
  joinDavUrl,
  isUnderRoots,
  isSyncDue,
  normalizePath,
  planIngest,
  ingestProvenanceHeader,
  buildNeo4jSyncPlan,
  parseNeo4jConfig,
  serializeNeo4jConfig,
  defaultNeo4jConfig,
  toSyncedRef,
  encrypt,
  safeDecrypt,
  type WebdavConnection,
  type WebdavEntry,
  type IngestEntry,
  type Neo4jConfig,
  type Note,
} from '@repo/shared';
import { api, getApiBaseUrl } from './api';
import { buildAuthHeaders } from './apiClient';
import { useStore } from '../stores/useStore';
import { indexEntities } from './ai/embeddingsService';
import { extractPdfText } from './ai/pdfText';

const CONNECTIONS_KEY = 'nextcloud_connections_v1';
const NEO4J_KEY = 'nextcloud_neo4j_config_v1';
const credKey = (id: string) => `nextcloud_pw_${id}`;

const MAX_FOLDERS = 300;
const MAX_FILES = 5000;
const TEXT_CAP = 1_000_000;

const ls = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage);

// ---- connection + credential storage (encrypted) -----------------------------

export const listConnections = (): WebdavConnection[] => {
  try { return JSON.parse(safeDecrypt(ls()?.getItem(CONNECTIONS_KEY) || '', '') || '[]') || []; } catch { return []; }
};
const writeConnections = (c: WebdavConnection[]): void => {
  try { ls()?.setItem(CONNECTIONS_KEY, encrypt(JSON.stringify(c))); } catch { /* best-effort */ }
};
export const saveConnection = (conn: WebdavConnection, password?: string): void => {
  enforceHttps(conn.baseUrl);
  const all = listConnections();
  const i = all.findIndex((c) => c.id === conn.id);
  if (i >= 0) all[i] = conn; else all.push(conn);
  writeConnections(all);
  if (password !== undefined) {
    try { if (password) ls()?.setItem(credKey(conn.id), encrypt(password)); else ls()?.removeItem(credKey(conn.id)); } catch { /* */ }
  }
};
export const deleteConnection = (id: string): void => {
  writeConnections(listConnections().filter((c) => c.id !== id));
  try { ls()?.removeItem(credKey(id)); } catch { /* */ }
};
const getPassword = (id: string): string => {
  try { const raw = ls()?.getItem(credKey(id)); return raw ? (safeDecrypt(raw, raw) || '') : ''; } catch { return ''; }
};

// ---- Neo4j config ------------------------------------------------------------

export const getNeo4jConfig = (): Neo4jConfig => {
  try { const raw = ls()?.getItem(NEO4J_KEY); return raw ? parseNeo4jConfig(safeDecrypt(raw, raw)) : defaultNeo4jConfig(); }
  catch { return defaultNeo4jConfig(); }
};
export const saveNeo4jConfig = (cfg: Neo4jConfig): void => {
  try { ls()?.setItem(NEO4J_KEY, encrypt(serializeNeo4jConfig(cfg))); } catch { /* */ }
};

/** Map of connectionId → its minContextLevel, for the chat's per-source retrieval gate. */
export const getSourceMinLevels = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of listConnections()) if (c.minContextLevel) out[c.id] = c.minContextLevel;
  return out;
};

// ---- WebDAV fetch ------------------------------------------------------------

const basicAuth = (u: string, p: string): string => 'Basic ' + btoa(unescape(encodeURIComponent(u + ':' + p)));

const propfind = async (conn: WebdavConnection, path: string): Promise<WebdavEntry[]> => {
  const url = joinDavUrl(conn.baseUrl, path);
  enforceHttps(url);
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: basicAuth(conn.username, getPassword(conn.id)), Depth: '1', 'Content-Type': 'application/xml' },
    body: buildPropfindBody(),
  });
  if (res.status === 401) throw new Error('Fel användarnamn/app-lösenord (401)');
  if (!res.ok && res.status !== 207) throw new Error('WebDAV-fel ' + res.status);
  return parsePropfindXml(await res.text(), joinDavUrl(conn.baseUrl, ''));
};

const getBytes = async (conn: WebdavConnection, path: string): Promise<ArrayBuffer> => {
  const res = await fetch(joinDavUrl(conn.baseUrl, path), { headers: { Authorization: basicAuth(conn.username, getPassword(conn.id)) } });
  if (!res.ok) throw new Error('Nedladdning misslyckades ' + res.status);
  return res.arrayBuffer();
};

export const testConnection = async (conn: WebdavConnection): Promise<{ ok: boolean; error?: string }> => {
  try { await propfind(conn, conn.rootPaths[0] || ''); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message || 'Anslutning misslyckades' }; }
};

export const browseFolders = async (conn: WebdavConnection, path = ''): Promise<WebdavEntry[]> =>
  (await propfind(conn, path)).filter((e) => e.isCollection);

const enumerateAll = async (conn: WebdavConnection): Promise<IngestEntry[]> => {
  const out: IngestEntry[] = [];
  const queue = [...(conn.rootPaths || []).map(normalizePath)];
  const seen = new Set<string>();
  let folders = 0;
  while (queue.length && folders < MAX_FOLDERS && out.length < MAX_FILES) {
    const dir = queue.shift() as string;
    if (seen.has(dir)) continue;
    seen.add(dir);
    folders += 1;
    let children: WebdavEntry[];
    try { children = await propfind(conn, dir); } catch { continue; }
    for (const c of children) {
      if (!isUnderRoots(c.path, conn.rootPaths)) continue;
      if (c.isCollection) { out.push(toIngest(c)); queue.push(c.path); }
      else if (classifyFile(c.name, c.contentType) !== 'skip') out.push(toIngest(c));
    }
  }
  return out;
};
const toIngest = (e: WebdavEntry): IngestEntry => ({
  path: e.path, name: e.name, isCollection: e.isCollection, etag: e.etag, mimeType: e.contentType, lastModified: e.lastModified,
});

const decodeText = (buf: ArrayBuffer): string => new TextDecoder('utf-8').decode(buf).slice(0, TEXT_CAP);

export interface SyncResult { created: number; updated: number; deleted: number; ok: boolean; error?: string }

export const syncConnection = async (connectionId: string): Promise<SyncResult> => {
  const conn = listConnections().find((c) => c.id === connectionId);
  if (!conn) return { created: 0, updated: 0, deleted: 0, ok: false, error: 'Anslutning saknas' };

  const store: any = useStore.getState();
  const allNotes: Note[] = store.notes || [];
  const existingRefs = allNotes.map((n) => toSyncedRef(n as any));
  let entries: IngestEntry[];
  try { entries = await enumerateAll(conn); }
  catch (e: any) { return { created: 0, updated: 0, deleted: 0, ok: false, error: e?.message || 'Sync misslyckades' }; }

  const plan = planIngest(entries, existingRefs, connectionId, new Date().toISOString());

  const pathToId = new Map<string, string>();
  for (const n of allNotes) {
    const src = toSyncedRef(n as any).source;
    if (src && src.connectionId === connectionId) pathToId.set(src.remotePath, n._id);
  }

  const extract = async (path: string, name: string, mime?: string): Promise<string> => {
    const kind = classifyFile(name, mime);
    if (kind === 'text') { try { return decodeText(await getBytes(conn, path)); } catch { return ''; } }
    if (kind === 'pdf') {
      try {
        const buf = await getBytes(conn, path);
        const file = new File([buf], name, { type: 'application/pdf' });
        return (await extractPdfText(file)) || '';
      } catch { return ''; }
    }
    return ''; // images: vision/OCR is Fas 2
  };

  let created = 0, updated = 0, deleted = 0;
  for (const draft of plan.creates) {
    const parentId = draft.parentRemotePath ? pathToId.get(draft.parentRemotePath) || null : null;
    let content = '';
    if (draft.needsContent) {
      const body = await extract(draft.source.remotePath, draft.title, draft.source.mimeType);
      content = ingestProvenanceHeader(draft.source) + (body ? '\n\n' + body : '\n\n[Inget extraherbart innehåll]');
    }
    try {
      const note = await api.createNote({ title: draft.title, content, tags: [], parentId, type: draft.type, source: draft.source } as any);
      pathToId.set(draft.source.remotePath, note._id);
      created += 1;
    } catch { /* continue */ }
  }
  for (const u of plan.updates) {
    const body = await extract(u.source.remotePath, u.title, u.source.mimeType);
    const content = ingestProvenanceHeader(u.source) + (body ? '\n\n' + body : '');
    try { await api.updateNote(u.noteId, { content, source: u.source } as any); updated += 1; } catch { /* */ }
  }
  for (const id of plan.deletes) {
    try { await api.deleteNote(id); deleted += 1; } catch { /* */ }
  }

  try { await store.fetchNotes?.(); } catch { /* */ }
  try {
    const s2: any = useStore.getState();
    await indexEntities(s2.notes || [], s2.tasks || [], new Set(s2.unlockedProtectedNoteIds || []));
  } catch { /* best-effort */ }

  saveConnection({ ...conn, lastSyncAt: new Date().toISOString() });
  return { created, updated, deleted, ok: true };
};

/** Sync every connection whose auto-sync interval has elapsed (call on load / interval tick). */
export const syncDueConnections = async (): Promise<number> => {
  const now = Date.now();
  let ran = 0;
  for (const conn of listConnections()) {
    if (isSyncDue(conn, now)) {
      try { await syncConnection(conn.id); ran += 1; } catch { /* continue */ }
    }
  }
  return ran;
};

// ---- Neo4j push --------------------------------------------------------------

export const neo4jStatus = async (): Promise<{ enabled: boolean }> => {
  try {
    const res = await fetch(`${getApiBaseUrl()}/neo4j/status`, { headers: await buildAuthHeaders() });
    return res.ok ? await res.json() : { enabled: false };
  } catch { return { enabled: false }; }
};

export const pushNeo4j = async (): Promise<{ ok: boolean; applied?: number; error?: string }> => {
  const cfg = getNeo4jConfig();
  if (!cfg.enabled) return { ok: false, error: 'Neo4j-sync är avstängd' };
  const s: any = useStore.getState();
  const userId = s.user?._id || s.user?.id || 'me';
  const statements = buildNeo4jSyncPlan(userId, s.notes || [], s.tasks || [], cfg, new Set(s.unlockedProtectedNoteIds || []));
  if (!statements.length) return { ok: true, applied: 0 };
  try {
    const res = await fetch(`${getApiBaseUrl()}/neo4j/sync`, {
      method: 'POST',
      headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statements }),
    });
    if (!res.ok) return { ok: false, error: 'Neo4j HTTP ' + res.status };
    const json = await res.json();
    return { ok: true, applied: json?.applied };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Neo4j-sync misslyckades' };
  }
};
