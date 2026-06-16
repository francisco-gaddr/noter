import express, { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { renderVaultFile, fileEtag, normalizeVaultPath, type MarkdownFileItem } from '@repo/shared';
import MarkdownShare, { IMarkdownShare, IMarkdownFile } from '../models/MarkdownShare';
import { verifyDavPassword, parseBasicAuth } from '../caldav/credentials';
import { isMarkdownSyncEnabled } from '../config/markdownExposure';
import { MD_DAV_BASE } from './base';
import { multistatus, responseXml, requestedProps, xmlEscape } from '../caldav/davXml';
import logger from '../utils/logger';

/**
 * Markdown WebDAV vault server (the note/files twin of caldav/server.ts). Serves a
 * user's client-pushed plaintext note projection as a read/write `.md` file tree that
 * Obsidian (Remotely Save), Finder, Android WebDAV apps, and widgets can mount. Mounted
 * at /api/md, BEFORE the app's browser-oriented middleware.
 *
 * SECURITY: per-share Basic-Auth credential (davUser + hashed secret), never the account
 * password. A credential maps to exactly one share scope; cross-scope → 403. The backend
 * can't read/write the E2E-encrypted note; reads render the opt-in, lock-aware projection;
 * writes (PUT/DELETE/MOVE) are recorded as a non-sensitive mutation intent the client
 * applies with the user's key, then re-pushes. Paths are projection-map keys (no
 * filesystem mapping), and are still validated against traversal in shared/normalizeVaultPath.
 */

const DAV_HEADER = '1, 2, 3';
const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY';

// --- failed-auth throttle (in-memory, per IP) ------------------------------
const authFails = new Map<string, { n: number; until: number }>();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 30;
const ipKey = (req: Request): string => (req.ip || req.socket?.remoteAddress || 'unknown');
const isThrottled = (req: Request): boolean => {
  const rec = authFails.get(ipKey(req));
  return !!rec && rec.until > Date.now() && rec.n >= FAIL_MAX;
};
const noteAuthFail = (req: Request): void => {
  const k = ipKey(req);
  const now = Date.now();
  const rec = authFails.get(k);
  if (!rec || rec.until < now) authFails.set(k, { n: 1, until: now + FAIL_WINDOW_MS });
  else rec.n += 1;
  if (authFails.size > 2048) for (const [key, v] of authFails) if (v.until < now) authFails.delete(key);
};

// --- path + tree -----------------------------------------------------------
interface MdPath {
  user?: string;
  /** Vault-relative path ('' = root collection). null = malformed/traversal. */
  vault: string | null;
  kind: 'root' | 'dir' | 'file' | 'unknown';
}

const files = (share: IMarkdownShare): IMarkdownFile[] => (share.files || []) as IMarkdownFile[];
const dirParent = (p: string): string => { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); };

/** Every directory path implied by the file set (excludes root ''). */
const dirsOf = (share: IMarkdownShare): Set<string> => {
  const dirs = new Set<string>();
  for (const f of files(share)) {
    let d = dirParent(f.path);
    while (d) { dirs.add(d); d = dirParent(d); }
  }
  return dirs;
};

const parseMdPath = (reqPath: string, share: IMarkdownShare): MdPath => {
  const segs = String(reqPath || '/').split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segs.length === 0) return { kind: 'root', vault: '' };
  const user = segs[0];
  const rest = segs.slice(1).join('/');
  if (rest === '') return { kind: 'root', vault: '', user };
  const vault = normalizeVaultPath(rest);
  if (vault === null) return { kind: 'unknown', vault: null, user };
  if (/\.(md|markdown)$/i.test(vault)) {
    return { kind: files(share).some((f) => f.path === vault) ? 'file' : 'unknown', vault, user };
  }
  // A directory: exists if it's an implied dir of the file set.
  return { kind: dirsOf(share).has(vault) ? 'dir' : 'unknown', vault, user };
};

// --- hrefs -----------------------------------------------------------------
const userBase = (user: string) => `${MD_DAV_BASE}/${encodeURIComponent(user)}`;
const hrefForDir = (user: string, vault: string) =>
  vault ? `${userBase(user)}/${vault.split('/').map(encodeURIComponent).join('/')}/` : `${userBase(user)}/`;
const hrefForFile = (user: string, vault: string) =>
  `${userBase(user)}/${vault.split('/').map(encodeURIComponent).join('/')}`;

// --- change tokens + dates -------------------------------------------------
const djb2 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
};
const collectionTag = (share: IMarkdownShare): string =>
  djb2(String((share.updatedAt as Date)?.getTime?.() || 0) + files(share).map((f) => f.path + f.etag).join(''));
const httpDate = (iso?: string): string => {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toUTCString();
};

// --- prop maps -------------------------------------------------------------
const dirPropMap = (share: IMarkdownShare, user: string, vault: string): Record<string, string> => {
  const name = vault ? (vault.split('/').pop() || '') : (share.name || 'Noter');
  return {
    resourcetype: '<d:resourcetype><d:collection/></d:resourcetype>',
    displayname: `<d:displayname>${xmlEscape(name)}</d:displayname>`,
    getlastmodified: `<d:getlastmodified>${httpDate(share.updatedAt?.toISOString?.())}</d:getlastmodified>`,
    getcontenttype: '<d:getcontenttype>httpd/unix-directory</d:getcontenttype>',
    'getctag': `<cs:getctag>${collectionTag(share)}</cs:getctag>`,
    supportedlock: '<d:supportedlock/>',
    'quota-used-bytes': '<d:quota-used-bytes>0</d:quota-used-bytes>',
    'quota-available-bytes': '<d:quota-available-bytes>0</d:quota-available-bytes>',
  };
};

const renderFile = (f: IMarkdownFile): string => renderVaultFile(f as unknown as MarkdownFileItem);

const filePropMap = (f: IMarkdownFile): Record<string, string> => {
  const body = renderFile(f);
  return {
    resourcetype: '<d:resourcetype/>',
    displayname: `<d:displayname>${xmlEscape(f.path.split('/').pop() || '')}</d:displayname>`,
    getetag: `<d:getetag>${f.etag || fileEtag(f as any)}</d:getetag>`,
    getcontenttype: '<d:getcontenttype>text/markdown; charset=utf-8</d:getcontenttype>',
    getcontentlength: `<d:getcontentlength>${Buffer.byteLength(body, 'utf8')}</d:getcontentlength>`,
    getlastmodified: `<d:getlastmodified>${httpDate(f.updatedAt)}</d:getlastmodified>`,
    supportedlock: '<d:supportedlock/>',
  };
};

const buildResponse = (href: string, available: Record<string, string>, requested: Set<string> | null): string => {
  const found: string[] = [];
  const notFound: string[] = [];
  if (!requested) {
    for (const k of Object.keys(available)) found.push(available[k]);
  } else {
    for (const name of requested) {
      if (available[name]) found.push(available[name]);
      else notFound.push(`<d:${name}/>`);
    }
  }
  return responseXml({ href, found, notFound });
};

const sendXml = (res: Response, status: number, body: string): void => {
  res.status(status);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('DAV', DAV_HEADER);
  res.send(body);
};

// --- mutations -------------------------------------------------------------
const enqueueMutation = async (
  share: IMarkdownShare,
  m: { op: 'upsert' | 'delete' | 'move'; path: string; destination?: string | null; body?: string | null },
  req?: Request,
): Promise<void> => {
  const mutation = {
    id: randomBytes(8).toString('hex'),
    op: m.op,
    path: String(m.path).slice(0, 1024),
    destination: m.destination ? String(m.destination).slice(0, 1024) : null,
    body: typeof m.body === 'string' ? m.body.slice(0, 2_000_000) : null,
    at: new Date(),
  };
  // DEDUP per path (collapse repeated writes of the same file — clients re-PUT often).
  await MarkdownShare.updateOne({ _id: share._id }, { $pull: { pendingMutations: { path: mutation.path } } });
  await MarkdownShare.updateOne(
    { _id: share._id },
    { $push: { pendingMutations: { $each: [mutation], $slice: -500 } } },
  );
  try {
    const io = req?.app?.get('io');
    const userId = String((share as any).userId || '');
    if (io && userId) {
      io.to(`user:${userId}`).emit('markdown:mutation', { shareId: share.shareId, path: mutation.path, op: mutation.op });
    }
  } catch { /* best-effort */ }
};

// --- method handlers -------------------------------------------------------
const handlePropfind = (req: Request, res: Response, share: IMarkdownShare, dp: MdPath): void => {
  const user = share.davUser as string;
  const depthHdr = String(req.headers['depth'] ?? 'infinity').toLowerCase();
  const requested = requestedProps(req.body || '');
  const responses: string[] = [];
  const all = files(share);
  const dirs = dirsOf(share);

  if (dp.kind === 'file') {
    const f = all.find((x) => x.path === dp.vault);
    if (!f) { sendXml(res, 404, multistatus([])); return; }
    responses.push(buildResponse(hrefForFile(user, f.path), filePropMap(f), requested));
    sendXml(res, 207, multistatus(responses));
    return;
  }

  if (dp.kind !== 'root' && dp.kind !== 'dir') { sendXml(res, 404, multistatus([])); return; }
  const base = dp.vault || ''; // '' = root
  responses.push(buildResponse(hrefForDir(user, base), dirPropMap(share, user, base), requested));

  if (depthHdr !== '0') {
    const prefix = base ? base + '/' : '';
    const infinite = depthHdr === 'infinity';
    // Child (or descendant) directories.
    for (const d of dirs) {
      if (!d.startsWith(prefix) || d === base) continue;
      const rel = d.slice(prefix.length);
      if (!infinite && rel.includes('/')) continue; // depth 1 → immediate only
      responses.push(buildResponse(hrefForDir(user, d), dirPropMap(share, user, d), requested));
    }
    // Child (or descendant) files.
    for (const f of all) {
      if (!f.path.startsWith(prefix)) continue;
      const rel = f.path.slice(prefix.length);
      if (!rel || (!infinite && rel.includes('/'))) continue;
      responses.push(buildResponse(hrefForFile(user, f.path), filePropMap(f), requested));
    }
  }
  sendXml(res, 207, multistatus(responses));
};

const handleGet = (res: Response, share: IMarkdownShare, dp: MdPath, head: boolean): void => {
  if (dp.kind !== 'file') { res.status(dp.kind === 'dir' || dp.kind === 'root' ? 405 : 404).end(); return; }
  const f = files(share).find((x) => x.path === dp.vault);
  if (!f) { res.status(404).end(); return; }
  const body = renderFile(f);
  res.status(200);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('ETag', f.etag || fileEtag(f as any));
  res.setHeader('Last-Modified', httpDate(f.updatedAt));
  res.setHeader('DAV', DAV_HEADER);
  if (head) { res.end(); return; }
  res.send(body);
};

const handlePut = async (req: Request, res: Response, share: IMarkdownShare, dp: MdPath): Promise<void> => {
  if (dp.vault === null) { res.status(400).end(); return; }
  if (!/\.(md|markdown)$/i.test(dp.vault)) { res.status(403).end(); return; } // vault is markdown-only
  const existing = files(share).some((f) => f.path === dp.vault);
  const body = typeof req.body === 'string' ? req.body : '';
  await enqueueMutation(share, { op: 'upsert', path: dp.vault, body }, req);
  res.setHeader('ETag', fileEtag({ noteId: dp.vault, title: '', body, tags: [], type: 'note' }));
  res.setHeader('DAV', DAV_HEADER);
  res.status(existing ? 204 : 201).end();
};

const handleDelete = async (req: Request, res: Response, share: IMarkdownShare, dp: MdPath): Promise<void> => {
  if (dp.kind === 'file' && dp.vault) {
    await enqueueMutation(share, { op: 'delete', path: dp.vault }, req);
    res.status(204).end();
    return;
  }
  res.status(dp.kind === 'dir' ? 403 : 404).end(); // directory delete not supported (implicit dirs)
};

const handleMove = async (req: Request, res: Response, share: IMarkdownShare, dp: MdPath): Promise<void> => {
  if (dp.kind !== 'file' || !dp.vault) { res.status(403).end(); return; }
  const destHeader = String(req.headers['destination'] || '');
  // Destination is an absolute URL or path; reduce to a vault-relative path under this user.
  let destPath = destHeader;
  try { destPath = new URL(destHeader).pathname; } catch { /* already a path */ }
  const after = destPath.split(`/${share.davUser}/`)[1] ?? destPath.replace(MD_DAV_BASE, '');
  const destVault = normalizeVaultPath(decodeURIComponent(after || ''));
  if (!destVault || !/\.(md|markdown)$/i.test(destVault)) { res.status(400).end(); return; }
  await enqueueMutation(share, { op: 'move', path: dp.vault, destination: destVault }, req);
  res.status(201).end();
};

// --- router ----------------------------------------------------------------
export const markdavRouter = express.Router();
markdavRouter.use(express.text({ type: () => true, limit: '4mb' }));

markdavRouter.use(async (req: Request, res: Response): Promise<void> => {
  const method = req.method.toUpperCase();

  res.on('finish', () => {
    logger.info('markdav', {
      method, path: req.path, status: res.statusCode,
      hasAuth: !!req.headers['authorization'], depth: req.headers['depth'], ua: req.headers['user-agent'],
    });
  });

  if (!isMarkdownSyncEnabled()) { res.status(404).end(); return; }

  if (method === 'OPTIONS') {
    res.setHeader('DAV', DAV_HEADER);
    res.setHeader('Allow', ALLOW);
    res.setHeader('MS-Author-Via', 'DAV');
    res.status(204).end();
    return;
  }

  if (isThrottled(req)) { res.setHeader('Retry-After', '900'); res.status(429).end(); return; }

  const creds = parseBasicAuth(req.headers['authorization']);
  const requireAuth = (): void => {
    res.setHeader('WWW-Authenticate', 'Basic realm="Noter"');
    res.setHeader('DAV', DAV_HEADER);
    res.status(401).end();
  };
  if (!creds || !creds.user || !creds.pass) { requireAuth(); return; }

  let share: IMarkdownShare | null = null;
  try {
    share = await MarkdownShare.findOne({ davUser: creds.user }).exec();
  } catch (err) {
    logger.warn('markdav: share lookup failed', { error: (err as Error)?.message });
    res.status(503).end();
    return;
  }
  if (!share || !share.davTokenHash || !verifyDavPassword(creds.pass, share.davTokenHash)) {
    noteAuthFail(req);
    requireAuth();
    return;
  }
  if (!share.modes?.webdav) { res.status(403).end(); return; } // WebDAV mode disabled for this share

  const dp = parseMdPath(req.path, share);
  if (dp.user && dp.user !== share.davUser) { res.status(403).end(); return; }

  const lastSeen = (share.davLastSeenAt as Date | null)?.getTime?.() || 0;
  if (Date.now() - lastSeen > 60_000) {
    void MarkdownShare.updateOne({ _id: share._id }, { $set: { davLastSeenAt: new Date() } }).catch(() => {});
  }

  const isRead = method === 'PROPFIND' || method === 'GET' || method === 'HEAD';
  const isWrite = method === 'PUT' || method === 'DELETE' || method === 'MOVE' || method === 'MKCOL' || method === 'COPY';
  if (isRead && !share.direction?.outbound) { res.status(403).end(); return; }
  if (isWrite && !share.direction?.inbound) { res.status(403).end(); return; }

  try {
    switch (method) {
      case 'PROPFIND': handlePropfind(req, res, share, dp); return;
      case 'GET': handleGet(res, share, dp, false); return;
      case 'HEAD': handleGet(res, share, dp, true); return;
      case 'PUT': await handlePut(req, res, share, dp); return;
      case 'DELETE': await handleDelete(req, res, share, dp); return;
      case 'MOVE': await handleMove(req, res, share, dp); return;
      case 'MKCOL': res.status(201).end(); return; // dirs are implicit; accept so clients can pre-create
      case 'PROPPATCH': {
        const requested = requestedProps(req.body || '') || new Set<string>();
        const props = [...requested].map((n) => `<d:${n}/>`).join('');
        const href = dp.vault ? hrefForFile(share.davUser as string, dp.vault) : `${MD_DAV_BASE}/`;
        sendXml(res, 207, multistatus([
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
          `<d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>`,
        ]));
        return;
      }
      case 'COPY': res.status(403).end(); return;
      default: res.setHeader('Allow', ALLOW); res.status(405).end(); return;
    }
  } catch (err) {
    logger.error('markdav: handler error', { method, path: req.path, error: (err as Error)?.message });
    res.status(500).end();
  }
});
