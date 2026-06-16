/**
 * Nextcloud (WebDAV) INBOUND ingestion — mobile service. The app acts as an on-device
 * WebDAV CLIENT: it PROPFINDs the user-selected folders, pulls files, and lands each as an
 * E2E-encrypted Note (via the store's createNote, which encrypts with the user's dataKey
 * before anything leaves the device). Once a file is a Note it flows through the existing
 * pipeline (index, graph, RAG, lock guard, realtime). See Doc/nextcloud-ingestion.md.
 *
 * SECURITY: the Nextcloud app-password lives ONLY in SecureStore (per connection), never
 * sent to the Noter backend. TLS is enforced. PROPFIND is hard-scoped under the selected
 * roots. The Neo4j sync uses the shared lock-safe selection — a locked subtree is never
 * mirrored — and pushes parameterized Cypher to the backend relay (titles+structure by
 * default; bodies only if the user opts in).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  buildPropfindBody,
  parsePropfindXml,
  classifyFile,
  enforceHttps,
  joinDavUrl,
  isUnderRoots,
  isSyncDue,
  buildLoginFlowInitUrl,
  parseLoginFlowInit,
  loginFlowPollBody,
  parseLoginFlowResult,
  baseUrlFromLoginResult,
  normalizePath,
  planIngest,
  ingestProvenanceHeader,
  buildNeo4jSyncPlan,
  parseNeo4jConfig,
  serializeNeo4jConfig,
  defaultNeo4jConfig,
  toSyncedRef,
  type WebdavConnection,
  type WebdavEntry,
  type IngestEntry,
  type Neo4jConfig,
  type Note,
} from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';
import { indexEntities } from '@/services/ai/embeddingsService';

const CONNECTIONS_KEY = 'nextcloud_connections_v1';
const NEO4J_KEY = 'nextcloud_neo4j_config_v1';
const credKey = (connectionId: string) => `nextcloud_pw_${connectionId}`;

const MAX_FOLDERS = 300;
const MAX_FILES = 5000;
const TEXT_BYTE_CAP = 1_000_000; // don't pull huge files into memory

// ---- base64 (RN-safe, no btoa dependency) -----------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const toBase64 = (input: string): string => {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    const e1 = a >> 2;
    const e2 = ((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4);
    const e3 = isNaN(b) ? 64 : ((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6);
    const e4 = isNaN(c) ? 64 : c & 63;
    out += B64[e1] + B64[e2] + B64[e3 === 64 ? 64 : e3] + B64[e4];
    if (e3 === 64) out = out.slice(0, -2) + '==';
    else if (e4 === 64) out = out.slice(0, -1) + '=';
  }
  return out;
};
const basicAuth = (user: string, pass: string): string => 'Basic ' + toBase64(user + ':' + pass);

// ---- connection storage ------------------------------------------------------

export const listConnections = async (): Promise<WebdavConnection[]> => {
  try { return JSON.parse((await AsyncStorage.getItem(CONNECTIONS_KEY)) || '[]') || []; } catch { return []; }
};
const writeConnections = async (c: WebdavConnection[]): Promise<void> => {
  await AsyncStorage.setItem(CONNECTIONS_KEY, JSON.stringify(c));
};
export const saveConnection = async (conn: WebdavConnection, password?: string): Promise<void> => {
  enforceHttps(conn.baseUrl);
  const all = await listConnections();
  const idx = all.findIndex((c) => c.id === conn.id);
  if (idx >= 0) all[idx] = conn; else all.push(conn);
  await writeConnections(all);
  if (password) await SecureStore.setItemAsync(credKey(conn.id), password);
};
export const deleteConnection = async (connectionId: string): Promise<void> => {
  await writeConnections((await listConnections()).filter((c) => c.id !== connectionId));
  await SecureStore.deleteItemAsync(credKey(connectionId)).catch(() => {});
};
const getPassword = async (connectionId: string): Promise<string> =>
  (await SecureStore.getItemAsync(credKey(connectionId)).catch(() => null)) || '';

const newConnId = () => 'nc_' + Math.abs(Date.now()).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

/**
 * Nextcloud Login Flow v2: open the host's login page in the browser (via the injected
 * `openUrl`) and poll until the user grants an app-password, then persist a connection with
 * that credential. No password typing; the app-password is revocable in Nextcloud.
 */
export const startNextcloudOAuth = async (
  host: string,
  openUrl: (url: string) => void | Promise<void>,
  opts: { name?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ ok: boolean; connectionId?: string; error?: string }> => {
  try {
    const initUrl = buildLoginFlowInitUrl(host);
    enforceHttps(initUrl);
    const initRes = await fetch(initUrl, { method: 'POST', headers: { 'User-Agent': 'Noter' } });
    if (!initRes.ok) return { ok: false, error: 'Login Flow init misslyckades (' + initRes.status + ')' };
    const init = parseLoginFlowInit(await initRes.json().catch(() => null));
    if (!init) return { ok: false, error: 'Oväntat svar från Nextcloud' };

    await openUrl(init.loginUrl);

    const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
    const interval = opts.intervalMs ?? 3000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const pollRes = await fetch(init.pollEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: loginFlowPollBody(init.pollToken),
      }).catch(() => null);
      if (!pollRes || pollRes.status === 404) continue; // still pending
      if (!pollRes.ok) return { ok: false, error: 'Login-poll fel (' + pollRes.status + ')' };
      const result = parseLoginFlowResult(await pollRes.json().catch(() => null));
      if (!result) continue;
      const conn: WebdavConnection = {
        id: newConnId(),
        name: opts.name || host.replace(/^https?:\/\//, ''),
        baseUrl: baseUrlFromLoginResult(result),
        username: result.loginName,
        rootPaths: [],
        createdAt: new Date().toISOString(),
      };
      await saveConnection(conn, result.appPassword);
      return { ok: true, connectionId: conn.id };
    }
    return { ok: false, error: 'Tidsgräns nådd — försök igen' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'OAuth misslyckades' };
  }
};

// ---- Neo4j config storage ----------------------------------------------------

export const getNeo4jConfig = async (): Promise<Neo4jConfig> => {
  try {
    const raw = await AsyncStorage.getItem(NEO4J_KEY);
    return raw ? parseNeo4jConfig(raw) : defaultNeo4jConfig();
  } catch { return defaultNeo4jConfig(); }
};
export const saveNeo4jConfig = async (cfg: Neo4jConfig): Promise<void> => {
  await AsyncStorage.setItem(NEO4J_KEY, serializeNeo4jConfig(cfg));
};

/** Map of connectionId → its minContextLevel, for the chat's per-source retrieval gate. */
export const getSourceMinLevels = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const c of await listConnections()) if (c.minContextLevel) out[c.id] = c.minContextLevel;
  return out;
};

// ---- WebDAV fetch helpers ----------------------------------------------------

const propfind = async (conn: WebdavConnection, path: string): Promise<WebdavEntry[]> => {
  const pw = await getPassword(conn.id);
  const url = joinDavUrl(conn.baseUrl, path);
  enforceHttps(url);
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(conn.username, pw),
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: buildPropfindBody(),
  });
  if (res.status === 401) throw new Error('Fel användarnamn/app-lösenord (401)');
  if (!res.ok && res.status !== 207) throw new Error('WebDAV-fel ' + res.status);
  const xml = await res.text();
  // PROPFIND on a subpath returns hrefs relative to baseUrl already; re-prefix the path.
  const entries = parsePropfindXml(xml, joinDavUrl(conn.baseUrl, '').replace(/\/$/, '') + '/');
  return entries;
};

const getText = async (conn: WebdavConnection, path: string): Promise<string> => {
  const pw = await getPassword(conn.id);
  const res = await fetch(joinDavUrl(conn.baseUrl, path), {
    headers: { Authorization: basicAuth(conn.username, pw) },
  });
  if (!res.ok) throw new Error('Nedladdning misslyckades ' + res.status);
  return res.text();
};

/** Verify a connection by listing the root (or first selected folder). */
export const testConnection = async (conn: WebdavConnection): Promise<{ ok: boolean; error?: string }> => {
  try { await propfind(conn, conn.rootPaths[0] || ''); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message || 'Anslutning misslyckades' }; }
};

/** List immediate child folders of a path (for the folder picker). */
export const browseFolders = async (conn: WebdavConnection, path = ''): Promise<WebdavEntry[]> => {
  const entries = await propfind(conn, path);
  return entries.filter((e) => e.isCollection);
};

// ---- recursive enumeration under the selected roots --------------------------

const enumerateAll = async (conn: WebdavConnection): Promise<IngestEntry[]> => {
  const out: IngestEntry[] = [];
  const queue = [...(conn.rootPaths || []).map(normalizePath)];
  const visited = new Set<string>();
  let folders = 0;
  while (queue.length && folders < MAX_FOLDERS && out.length < MAX_FILES) {
    const dir = queue.shift() as string;
    if (visited.has(dir)) continue;
    visited.add(dir);
    folders += 1;
    let children: WebdavEntry[];
    try { children = await propfind(conn, dir); } catch { continue; }
    for (const c of children) {
      if (!isUnderRoots(c.path, conn.rootPaths)) continue;
      if (c.isCollection) {
        out.push({ path: c.path, name: c.name, isCollection: true, etag: c.etag, mimeType: c.contentType, lastModified: c.lastModified });
        queue.push(c.path);
      } else if (classifyFile(c.name, c.contentType) !== 'skip') {
        out.push({ path: c.path, name: c.name, isCollection: false, etag: c.etag, mimeType: c.contentType, lastModified: c.lastModified });
      }
    }
  }
  return out;
};

export interface SyncResult { created: number; updated: number; deleted: number; ok: boolean; error?: string }

/**
 * Pull the selected folders, diff against already-synced notes, and apply creates/updates/
 * deletes through the store (which E2E-encrypts). Then reindex for semantic search. Folders
 * map to project notes; files to notes nested under their folder.
 */
export const syncConnection = async (connectionId: string): Promise<SyncResult> => {
  const conn = (await listConnections()).find((c) => c.id === connectionId);
  if (!conn) return { created: 0, updated: 0, deleted: 0, ok: false, error: 'Anslutning saknas' };

  const store: any = useStore.getState();
  const allNotes: Note[] = store.notes || [];
  const existingRefs = allNotes.map((n) => toSyncedRef(n as any));
  let entries: IngestEntry[];
  try { entries = await enumerateAll(conn); }
  catch (e: any) { return { created: 0, updated: 0, deleted: 0, ok: false, error: e?.message || 'Sync misslyckades' }; }

  const syncedAt = new Date().toISOString();
  const plan = planIngest(entries, existingRefs, connectionId, syncedAt);

  // Resolve a remotePath → noteId map as we create folders (so children get the right parent).
  const pathToId = new Map<string, string>();
  for (const n of allNotes) {
    const src = toSyncedRef(n as any).source;
    if (src && src.connectionId === connectionId) pathToId.set(src.remotePath, n._id);
  }

  let created = 0, updated = 0, deleted = 0;
  // creates are already ordered folders→files, shallow→deep by planIngest.
  for (const draft of plan.creates) {
    const parentId = draft.parentRemotePath ? pathToId.get(draft.parentRemotePath) || null : null;
    let content = '';
    if (draft.needsContent && classifyFile(draft.title, draft.source.mimeType) === 'text') {
      try {
        const raw = await getText(conn, draft.source.remotePath);
        content = ingestProvenanceHeader(draft.source) + '\n\n' + raw.slice(0, TEXT_BYTE_CAP);
      } catch { content = ingestProvenanceHeader(draft.source); }
    } else if (draft.needsContent) {
      // pdf/image on mobile: provenance placeholder for now (extraction is Fas 2).
      content = ingestProvenanceHeader(draft.source) + '\n\n[Innehåll ej extraherat på mobil ännu]';
    }
    try {
      const note = await store.createNote({
        title: draft.title,
        content,
        tags: [],
        parentId,
        type: draft.type,
        source: draft.source,
      });
      pathToId.set(draft.source.remotePath, note._id);
      created += 1;
    } catch { /* skip this file, continue */ }
  }
  for (const u of plan.updates) {
    let content = ingestProvenanceHeader(u.source);
    if (classifyFile(u.title, u.source.mimeType) === 'text') {
      try { content += '\n\n' + (await getText(conn, u.source.remotePath)).slice(0, TEXT_BYTE_CAP); } catch { /* keep header */ }
    }
    try { await store.updateNote(u.noteId, { content, source: u.source }); updated += 1; } catch { /* continue */ }
  }
  for (const id of plan.deletes) {
    try { await store.deleteNote(id); deleted += 1; } catch { /* continue */ }
  }

  // Reindex (lock-safe; never throws) so the new notes are semantically searchable.
  try {
    const s2: any = useStore.getState();
    await indexEntities(s2.notes || [], s2.tasks || [], new Set(s2.unlockedProtectedNoteIds || []));
  } catch { /* best-effort */ }

  // Persist last-sync timestamp on the connection (drives isSyncDue).
  await saveConnection({ ...conn, lastSyncAt: new Date().toISOString() }, undefined).catch(() => {});

  return { created, updated, deleted, ok: true };
};

/** Sync every connection whose auto-sync interval has elapsed (call on app foreground / tick). */
export const syncDueConnections = async (): Promise<number> => {
  const now = Date.now();
  let ran = 0;
  for (const conn of await listConnections()) {
    if (isSyncDue(conn, now)) {
      try { await syncConnection(conn.id); ran += 1; } catch { /* continue */ }
    }
  }
  return ran;
};

// ---- Neo4j push --------------------------------------------------------------

export const neo4jStatus = async (): Promise<{ enabled: boolean }> => {
  try { return await fetchWithAuth('/neo4j/status'); } catch { return { enabled: false }; }
};

/** Build the lock-safe selection on-device and relay the parameterized Cypher to the backend. */
export const pushNeo4j = async (): Promise<{ ok: boolean; applied?: number; error?: string }> => {
  const cfg = await getNeo4jConfig();
  if (!cfg.enabled) return { ok: false, error: 'Neo4j-sync är avstängd' };
  const s: any = useStore.getState();
  const userId = s.user?._id || s.user?.id || 'me';
  const statements = buildNeo4jSyncPlan(
    userId, s.notes || [], s.tasks || [], cfg, new Set(s.unlockedProtectedNoteIds || []),
  );
  if (!statements.length) return { ok: true, applied: 0 };
  try {
    const res = await fetchWithAuth('/neo4j/sync', { method: 'POST', body: JSON.stringify({ statements }) });
    return { ok: true, applied: res?.applied };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Neo4j-sync misslyckades' };
  }
};
