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
  normalizeNoteType,
  syncedFileIsEditable,
  embeddingContentHash,
  buildNeo4jSyncPlan,
  parseNeo4jConfig,
  serializeNeo4jConfig,
  defaultNeo4jConfig,
  toSyncedRef,
  type WebdavConnection,
  type WebdavEntry,
  type IngestEntry,
  type Neo4jConfig,
  type NoteSource,
  type Note,
} from '@repo/shared';
import { fetchWithAuth } from '@/services/api';
import { useStore } from '@/stores/useStore';
import { indexEntities } from '@/services/ai/embeddingsService';
import { extractPdfTextMobile, extractImageOcrMobile, extractDocxMobile, extractXlsxMobile, isPdfHostReady, waitForPdfHost } from '@/services/ai/pdfText';
import { noteContentToPlainText } from '@/utils/tiptap';

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

// ---- target project folder (where synced content lands + is shown) -----------
const TARGET_KEY = 'nextcloud_target_folder_v1';
export const getTargetFolderId = async (): Promise<string | null> => {
  try { return (await AsyncStorage.getItem(TARGET_KEY)) || null; } catch { return null; }
};
export const setTargetFolderId = async (id: string | null): Promise<void> => {
  try { if (id) await AsyncStorage.setItem(TARGET_KEY, id); else await AsyncStorage.removeItem(TARGET_KEY); } catch { /* */ }
};
/**
 * Resolve the local project folder that synced content nests under. We NEVER auto-create a
 * "Nextcloud" wrapper folder — the synced folder(s) appear at the app root with their own real
 * names. Only an EXPLICIT user choice (the optional picker in settings) that still exists is
 * honored; anything else → null (root).
 */
const resolveTargetFolderId = async (): Promise<string | null> => {
  const wanted = await getTargetFolderId();
  if (!wanted) return null;
  const store: any = useStore.getState();
  const notes: Note[] = store.notes || [];
  return notes.some((n) => n._id === wanted && !n.deleted) ? wanted : null;
};

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

/** Map of connectionId → its retrieval-gate level for the chat. `includeInChat === false`
 *  maps to the '__never__' sentinel (excluded from chat context entirely). */
export const getSourceMinLevels = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const c of await listConnections()) {
    if (c.includeInChat === false) out[c.id] = '__never__';
    else if (c.minContextLevel) out[c.id] = c.minContextLevel;
  }
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

/** Upload (PUT) text content back to a WebDAV file. Returns the new ETag (or '' if not given). */
const putText = async (conn: WebdavConnection, path: string, content: string): Promise<string> => {
  const pw = await getPassword(conn.id);
  const res = await fetch(joinDavUrl(conn.baseUrl, path), {
    method: 'PUT',
    headers: { Authorization: basicAuth(conn.username, pw), 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error('Uppladdning misslyckades ' + res.status);
  return stripQuotesEtag(res.headers.get('etag') || '');
};
const stripQuotesEtag = (s: string): string => (s || '').replace(/^W\//i, '').replace(/^"+|"+$/g, '');

const PDF_MAX_BYTES = 8_000_000; // cap PDFs pulled through the WebView bridge

/** Fetch a binary file and return its base64 (no data: prefix), or '' on failure/oversize. */
const getBase64 = async (conn: WebdavConnection, path: string): Promise<string> => {
  const pw = await getPassword(conn.id);
  const res = await fetch(joinDavUrl(conn.baseUrl, path), { headers: { Authorization: basicAuth(conn.username, pw) } });
  if (!res.ok) return '';
  const blob = await res.blob();
  if ((blob as any).size && (blob as any).size > PDF_MAX_BYTES) return '';
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => resolve(String(fr.result || ''));
    fr.readAsDataURL(blob);
  });
  return dataUrl.indexOf(',') >= 0 ? dataUrl.slice(dataUrl.indexOf(',') + 1) : '';
};

/** Extract readable text for a file by kind: text inline, PDF via the WebView pdf.js host. */
const extractFileText = async (conn: WebdavConnection, path: string, name: string, mime?: string): Promise<string> => {
  const kind = classifyFile(name, mime);
  if (kind === 'text') { try { return (await getText(conn, path)).slice(0, TEXT_BYTE_CAP); } catch { return ''; } }
  if (kind === 'pdf' && isPdfHostReady()) {
    try {
      const b64 = await getBase64(conn, path);
      if (!b64) return '';
      return (await extractPdfTextMobile(b64)) || '';
    } catch { return ''; }
  }
  if ((kind === 'image' || kind === 'docx' || kind === 'xlsx') && isPdfHostReady()) {
    try {
      const b64 = await getBase64(conn, path);
      if (!b64) return '';
      if (kind === 'docx') return (await extractDocxMobile(b64)) || '';
      if (kind === 'xlsx') return (await extractXlsxMobile(b64)) || '';
      const text = (await extractImageOcrMobile(b64)) || '';
      return text.trim() ? '[OCR-text ur bild]\n' + text : '';
    } catch { return ''; }
  }
  return ''; // host absent / pages / unsupported → provenance-only note
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

const enumerateAll = async (conn: WebdavConnection, onlyUnderPath?: string): Promise<IngestEntry[]> => {
  const out: IngestEntry[] = [];
  // Scope to a single folder subtree (fast per-folder pull) when asked, else all selected roots.
  const scoped = onlyUnderPath ? normalizePath(onlyUnderPath) : '';
  const queue = scoped ? [scoped] : [...(conn.rootPaths || []).map(normalizePath)];
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
      if (scoped && !isUnderRoots(c.path, [scoped])) continue;
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

export interface SyncResult { created: number; updated: number; deleted: number; pushed?: number; ok: boolean; error?: string }

/**
 * OUTBOUND (two-way): push local edits of editable text/md notes back to Nextcloud. A note is
 * "edited" when the hash of its current body differs from `source.contentHash` (set at the last
 * sync). Only editable text files are pushed (binaries are read-only). Returns the count pushed.
 */
const sanitizeFileName = (t: string): string =>
  (String(t || '').replace(/[\/\\:*?"<>| -]/g, '_').trim().slice(0, 120)) || 'note';

const pushLocalEditsForConnection = async (conn: WebdavConnection): Promise<number> => {
  const store: any = useStore.getState();
  const notes: Note[] = store.notes || [];
  const byId = new Map<string, Note>(notes.map((n) => [n._id, n]));
  let pushed = 0;
  for (const n of notes) {
    if (n.deleted) continue;
    const src = (n as any).source as NoteSource | null;
    if (!src || src.connectionId !== conn.id || !syncedFileIsEditable(src)) continue;
    // The mobile editor stores rich content as HTML; a .md/.txt file must receive plain text,
    // never raw HTML tags. Flatten to plain text and hash that SAME representation so an
    // unedited note matches src.contentHash (no spurious push) and a pushed note doesn't loop.
    const body = noteContentToPlainText(n.content || '');
    const hash = embeddingContentHash(body);
    if (src.contentHash && src.contentHash === hash) continue; // unchanged since last sync
    try {
      const newEtag = await putText(conn, src.remotePath, body);
      const nextSrc: NoteSource = { ...src, remoteEtag: newEtag || src.remoteEtag, contentHash: hash, syncedAt: new Date().toISOString() };
      await store.updateNote(n._id, { source: nextSrc });
      pushed += 1;
    } catch { /* skip this file; retried next sync */ }
  }

  // NEW notes created INSIDE a synced folder (e.g. by the user OR the AI) have no `source` yet —
  // create them on the server so they appear in Nextcloud/Obsidian and become 2-way synced.
  // Security: never push a locked note or one whose parent folder is locked.
  for (const n of notes) {
    if (n.deleted || (n as any).source) continue;
    if (n.locked) continue;
    if (normalizeNoteType((n as any).type) !== 'note') continue; // folders are created by inbound sync
    const parent = n.parentId ? byId.get(n.parentId) : null;
    const ps = parent ? ((parent as any).source as NoteSource | null) : null;
    if (!parent || parent.locked || !ps || ps.connectionId !== conn.id) continue; // parent must be THIS conn's synced folder
    const body = noteContentToPlainText(n.content || '');
    const title = (n.title || '').trim();
    if (!title && !body.trim()) continue; // never push an empty placeholder
    const remotePath = ps.remotePath.replace(/\/+$/, '') + '/' + sanitizeFileName(title || 'note') + '.md';
    try {
      const etag = await putText(conn, remotePath, body);
      const newSrc: NoteSource = {
        origin: 'nextcloud', connectionId: conn.id, remotePath, remoteEtag: etag || '',
        mimeType: 'text/markdown', contentHash: embeddingContentHash(body), syncedAt: new Date().toISOString(),
      };
      await store.updateNote(n._id, { source: newSrc });
      pushed += 1;
    } catch { /* retried next sync */ }
  }
  return pushed;
};

/** Public: push edits for ALL connections (called by the on-save hook + 'Synka nu'). */
export const pushAllLocalEdits = async (): Promise<number> => {
  let total = 0;
  for (const conn of await listConnections()) {
    try { total += await pushLocalEditsForConnection(conn); } catch { /* */ }
  }
  return total;
};

/**
 * Pull the selected folders, diff against already-synced notes, and apply creates/updates/
 * deletes through the store (which E2E-encrypts). Then reindex for semantic search. Folders
 * map to project notes; files to notes nested under their folder.
 */
const inFlightSync = new Set<string>();
export const syncConnection = async (connectionId: string, opts?: { onlyUnderPath?: string }): Promise<SyncResult> => {
  // Stability: never let two syncs of the same connection overlap (manual + interval + on-enter
  // can all fire). A second concurrent call is a no-op success.
  if (inFlightSync.has(connectionId)) return { created: 0, updated: 0, deleted: 0, ok: true };
  inFlightSync.add(connectionId);
  try { useStore.getState().beginSourceSync(); } catch { /* */ }
  try {
  const conn = (await listConnections()).find((c) => c.id === connectionId);
  if (!conn) return { created: 0, updated: 0, deleted: 0, ok: false, error: 'Anslutning saknas' };

  const store: any = useStore.getState();
  const allNotes: Note[] = store.notes || [];
  const existingRefs = allNotes.map((n) => toSyncedRef(n as any));
  let entries: IngestEntry[];
  // Scoped (single-folder) pull when asked — much faster than enumerating the whole connection.
  try { entries = await enumerateAll(conn, opts?.onlyUnderPath); }
  catch (e: any) { return { created: 0, updated: 0, deleted: 0, ok: false, error: e?.message || 'Sync misslyckades' }; }

  // If any selected file needs the WebView extractor (PDF/Word/Excel/image), wait briefly for
  // the host to mount — otherwise a cold-start sync would land them empty and (unchanged ETag)
  // never re-extract. Cheap no-op once the host is ready.
  const needsHost = entries.some((e) => {
    const k = classifyFile(e.name, e.mimeType);
    return k === 'pdf' || k === 'docx' || k === 'xlsx' || k === 'image';
  });
  if (needsHost) await waitForPdfHost(6000);

  // OUTBOUND first (two-way): push local edits of editable text/md notes back to Nextcloud.
  let pushed = 0;
  try { pushed = await pushLocalEditsForConnection(conn); } catch { /* non-fatal */ }

  const syncedAt = new Date().toISOString();
  const plan = planIngest(entries, existingRefs, connectionId, syncedAt, opts?.onlyUnderPath);

  // Where synced content lands + is shown (a chosen/auto project folder). Top-level synced root
  // folders nest UNDER it instead of at the app root.
  const targetFolderId = await resolveTargetFolderId();

  // Stamp the source: content hash (for outbound edit-detection) + self-heal. A rich file whose
  // extraction came back empty (host warming up / transient error / scanned PDF) gets an EMPTY
  // ETag so the next sync retries it instead of being stuck on a placeholder note forever.
  const stampSource = (src: NoteSource, body: string): NoteSource => {
    const k = classifyFile(src.remotePath, src.mimeType);
    const isRich = k === 'pdf' || k === 'docx' || k === 'xlsx' || k === 'image';
    return {
      ...src,
      remoteEtag: isRich && !body.trim() ? '' : src.remoteEtag,
      contentHash: embeddingContentHash(body || ''),
    };
  };

  const pathToId = new Map<string, string>();
  for (const n of allNotes) {
    const src = toSyncedRef(n as any).source;
    if (src && src.connectionId === connectionId) pathToId.set(src.remotePath, n._id);
  }

  let created = 0, updated = 0, deleted = 0;
  // creates are already ordered folders→files, shallow→deep by planIngest.
  for (const draft of plan.creates) {
    // Top-level roots → under the chosen target folder; nested → under their parent note.
    const parentId = draft.parentRemotePath ? pathToId.get(draft.parentRemotePath) || null : targetFolderId;
    let body = '';
    if (draft.needsContent) {
      body = await extractFileText(conn, draft.source.remotePath, draft.title, draft.source.mimeType);
    }
    try {
      // SELF-HEAL / no-dup: if a note already sits under this parent with the same name (e.g. an
      // older note whose `source` was lost), ADOPT it — re-stamp its source instead of creating a
      // duplicate. This is what makes folder-info read "synced" and 2-way push work on old notes.
      const orphan = (useStore.getState().notes || []).find((n: any) =>
        !n.deleted &&
        (n.parentId || null) === (parentId || null) &&
        (n.title || '').trim() === draft.title.trim() &&
        normalizeNoteType(n.type) === draft.type,
      );
      if (orphan) {
        const patch: any = { source: stampSource(draft.source, body), type: draft.type };
        if (draft.needsContent) patch.content = body;
        await store.updateNote(orphan._id, patch);
        pathToId.set(draft.source.remotePath, orphan._id);
        updated += 1;
        continue;
      }
      const note = await store.createNote({
        title: draft.title,
        content: body, // body only — no metadata header (metadata lives in `source`, shown via ⋯→info)
        tags: [],
        parentId,
        type: draft.type,
        source: stampSource(draft.source, body),
      });
      pathToId.set(draft.source.remotePath, note._id);
      created += 1;
    } catch { /* skip this file, continue */ }
  }
  for (const u of plan.updates) {
    const body = await extractFileText(conn, u.source.remotePath, u.title, u.source.mimeType);
    try { await store.updateNote(u.noteId, { content: body, source: stampSource(u.source, body) }); updated += 1; } catch { /* continue */ }
  }
  for (const id of plan.deletes) {
    try { await store.deleteNote(id); deleted += 1; } catch { /* continue */ }
  }

  // Reindex (lock-safe; never throws) so the new notes are semantically searchable.
  // SECURITY: EMPTY unlock set — the embeddings/vector index must never hold locked content,
  // even a folder the user currently has open in the UI (the AI/RAG reads this index).
  try {
    const s2: any = useStore.getState();
    await indexEntities(s2.notes || [], s2.tasks || [], new Set());
  } catch { /* best-effort */ }

  // Persist last-sync timestamp on the connection (drives isSyncDue).
  await saveConnection({ ...conn, lastSyncAt: new Date().toISOString() }, undefined).catch(() => {});

  return { created, updated, deleted, pushed, ok: true };
  } finally {
    inFlightSync.delete(connectionId);
    try { useStore.getState().endSourceSync(); } catch { /* */ }
  }
};

// Throttle on-enter-folder syncs so re-entering a folder repeatedly doesn't hammer the server.
const lastEnterSync = new Map<string, number>();
const ENTER_SYNC_THROTTLE_MS = 30_000;
/**
 * Fire a sync for the connection(s) relevant to a project folder the user just entered — so
 * re-opening a Nextcloud-backed folder pulls fresh changes from other clients. Throttled per
 * connection; fire-and-forget (never blocks navigation). Folder with a Nextcloud `source` →
 * its connection; the target "Nextcloud" folder → all connections.
 */
export const syncOnEnterFolder = async (folderId: string | null): Promise<void> => {
  if (!folderId) return;
  try {
    const store: any = useStore.getState();
    const notes: Note[] = store.notes || [];
    const folder = notes.find((n) => n._id === folderId);
    const connIds = new Set<string>();
    const fsrc = (folder as any)?.source;
    if (fsrc?.connectionId) connIds.add(fsrc.connectionId);
    if (folderId === (await getTargetFolderId())) (await listConnections()).forEach((c) => connIds.add(c.id));
    const now = Date.now();
    for (const id of connIds) {
      if ((lastEnterSync.get(id) || 0) > now - ENTER_SYNC_THROTTLE_MS) continue;
      lastEnterSync.set(id, now);
      void syncConnection(id).catch(() => {});
    }
  } catch { /* never block navigation */ }
};

/**
 * Force a full, un-throttled sync of the Nextcloud connection(s) backing a project folder — used
 * by pull-to-refresh / the per-folder "Synka nu" button. Awaitable (so the spinner reflects real
 * work) and pushes local edits out too. Returns an observable result (counts + first error) so the
 * UI can show the user what actually happened instead of failing silently.
 */
export interface FolderSyncOutcome { matched: boolean; created: number; updated: number; deleted: number; pushed: number; ok: boolean; error?: string }
export const forceSyncFolder = async (folderId: string | null): Promise<FolderSyncOutcome> => {
  const out: FolderSyncOutcome = { matched: false, created: 0, updated: 0, deleted: 0, pushed: 0, ok: true };
  if (!folderId) return out;
  try {
    const store: any = useStore.getState();
    const notes: Note[] = store.notes || [];
    const folder = notes.find((n) => n._id === folderId);
    const connIds = new Set<string>();
    // The folder itself, or any ancestor, may carry the Nextcloud source. Capture the folder's
    // OWN remotePath (if it has one) so we can scope the sync to just this subtree.
    const onlyUnderPath: string | undefined = (folder as any)?.source?.remotePath || undefined;
    let cur: any = folder;
    let hops = 0;
    while (cur && hops < 50) {
      const s = (cur as any)?.source;
      if (s?.connectionId) { connIds.add(s.connectionId); break; }
      cur = notes.find((n) => n._id === cur.parentId);
      hops += 1;
    }
    const isTarget = folderId === (await getTargetFolderId());
    if (isTarget) (await listConnections()).forEach((c) => connIds.add(c.id));
    if (connIds.size === 0) return out; // not a Nextcloud-backed folder → caller falls back
    out.matched = true;
    for (const id of connIds) {
      lastEnterSync.set(id, Date.now()); // reset throttle so the next auto-enter doesn't double-fire
      try {
        // Scope to this folder's subtree (fast) — but the app-root "target" folder syncs fully.
        const r = await syncConnection(id, isTarget ? undefined : { onlyUnderPath });
        out.created += r.created; out.updated += r.updated; out.deleted += r.deleted; out.pushed += r.pushed || 0;
        if (!r.ok && !out.error) { out.ok = false; out.error = r.error; }
      } catch (e: any) { out.ok = false; if (!out.error) out.error = e?.message || 'Synk misslyckades'; }
    }
    return out;
  } catch (e: any) { return { ...out, ok: false, error: e?.message || 'Synk misslyckades' }; }
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
  if (!cfg.enabled) return { ok: false, error: 'Neo4j-sync är avstängd i appens inställningar.' };
  // Server gate: /neo4j/sync 404s ("API Endpoint Not Found") when NEO4J_ENABLED!=1 on the backend.
  // Check status first so the user gets an actionable message instead of a cryptic 404.
  const status = await neo4jStatus().catch(() => ({ enabled: false }));
  if (!status?.enabled) {
    return { ok: false, error: 'Neo4j-sync är inte aktiverad på servern. Aktivera NEO4J_ENABLED=1 och starta neo4j-tjänsten på servern.' };
  }
  const s: any = useStore.getState();
  const userId = s.user?._id || s.user?.id || 'me';
  // SECURITY: never pass the UI unlock set — buildNeo4jSyncPlan is hard-wired to the empty
  // set so a locked folder (even one open in the UI) is never mirrored to the external graph.
  const statements = buildNeo4jSyncPlan(userId, s.notes || [], s.tasks || [], cfg);
  if (!statements.length) return { ok: true, applied: 0 };
  try {
    const res = await fetchWithAuth('/neo4j/sync', {
      method: 'POST',
      body: JSON.stringify({ statements, database: cfg.database || undefined, httpUrl: cfg.httpUrl || undefined }),
    });
    return { ok: true, applied: res?.applied };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Neo4j-sync misslyckades' };
  }
};
