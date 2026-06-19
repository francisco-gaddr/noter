import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import MarkdownShare from '../models/MarkdownShare';
import { ackPendingMutations } from '../utils/pendingMutations';
import { UnauthorizedError } from '../utils/httpErrors';
import { genDavUser, genDavPassword, hashDavPassword } from '../caldav/credentials';
import { isMarkdownSyncEnabled, isMarkdownCrdtEnabled } from '../config/markdownExposure';
import { MD_DAV_BASE } from '../markdav/base';

/**
 * External Markdown SHARES management (the note/files twin of routes/calendar.ts).
 * REST at /api/markdown (the WebDAV vault itself is the separate /api/md router).
 *
 *   GET  /api/markdown/shares            AUTH — list shares.
 *   POST /api/markdown/shares            AUTH — create { name, folderIds, noteIds, modes?, direction?, files? }.
 *   PUT  /api/markdown/shares/:id        AUTH — update scope/modes/direction + push the files projection.
 *   DEL  /api/markdown/shares/:id        AUTH — delete a share (WebDAV + CRDT).
 *   POST /api/markdown/shares/:id/dav    AUTH — mint/rotate the WebDAV credential (password once).
 *   DEL  /api/markdown/shares/:id/dav    AUTH — revoke the WebDAV credential.
 *   POST /api/markdown/shares/:id/crdt   AUTH — mint/rotate the CRDT (Live) token (token once).
 *   DEL  /api/markdown/shares/:id/crdt   AUTH — revoke the CRDT token + disable Live mode.
 *   GET  /api/markdown/mutations         AUTH — drain inbound WebDAV write-backs.
 *   POST /api/markdown/mutations/ack     AUTH — ack applied mutations.
 *
 * Notes are E2E-encrypted; the client pushes a lock-aware plaintext projection (`files`).
 * See MarkdownShare + markdav/. Doc/external-markdown-sync.md.
 */
const router = express.Router();

const baseHost = (req: Request): string =>
  (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const buildDavUrls = (req: Request, davUser: string): { serverUrl: string; collectionUrl: string } => {
  const host = baseHost(req);
  return {
    serverUrl: `${host}${MD_DAV_BASE}/`,
    collectionUrl: `${host}${MD_DAV_BASE}/${encodeURIComponent(davUser)}/`,
  };
};

const crdtWsUrl = (req: Request, shareId: string): string => {
  const host = baseHost(req).replace(/^http/i, 'ws');
  return `${host}/api/md-crdt/${encodeURIComponent(shareId)}`;
};

const genShareId = (): string => crypto.randomBytes(8).toString('hex');
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const sanitizeName = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().slice(0, 60) : '');

const sanitizeIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && ID_RE.test(s)) out.add(s);
    if (out.size >= 1000) break;
  }
  return [...out];
};

const sanitizeModes = (raw: any): { webdav: boolean; crdt: boolean } => ({
  webdav: raw?.webdav !== false,
  crdt: !!raw?.crdt,
});
const sanitizeDirection = (raw: any): { outbound: boolean; inbound: boolean } => ({
  outbound: raw?.outbound !== false,
  inbound: raw?.inbound !== false,
});

const sanitizeFiles = (raw: unknown): any[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of raw.slice(0, 5000)) {
    const path = String((r as any)?.path || '').slice(0, 1024).replace(/^\/+/, '');
    const noteId = String((r as any)?.noteId || '').slice(0, 200);
    if (!path || !noteId || !/\.(md|markdown)$/i.test(path) || path.includes('..') || seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    const tags = Array.isArray((r as any)?.tags) ? (r as any).tags.filter((t: any) => typeof t === 'string').slice(0, 64) : [];
    out.push({
      path,
      noteId,
      title: String((r as any)?.title || '').slice(0, 500),
      body: String((r as any)?.body || '').slice(0, 2_000_000),
      tags,
      type: String((r as any)?.type || 'note').slice(0, 32),
      createdAt: String((r as any)?.createdAt || ''),
      updatedAt: String((r as any)?.updatedAt || ''),
      etag: String((r as any)?.etag || '').slice(0, 64),
    });
  }
  return out;
};

const shareView = (req: Request, share: any) => ({
  shareId: share.shareId,
  name: share.name || '',
  folderIds: Array.isArray(share.folderIds) ? share.folderIds : [],
  noteIds: Array.isArray(share.noteIds) ? share.noteIds : [],
  modes: share.modes || { webdav: true, crdt: false },
  direction: share.direction || { outbound: true, inbound: true },
  count: Array.isArray(share.files) ? share.files.length : 0,
  dav: share.davUser
    ? { username: share.davUser, lastSeenAt: share.davLastSeenAt ?? null, ...buildDavUrls(req, share.davUser) }
    : null,
  crdt: share.crdtTokenHash ? { enabled: !!share.modes?.crdt, wsUrl: crdtWsUrl(req, share.shareId) } : null,
});

const requireUser = (req: AuthRequest): string => {
  const userId = req.user?.userId;
  if (!userId) throw new UnauthorizedError('Not authenticated');
  return userId;
};

router.get('/shares', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shares = await MarkdownShare.find({ userId }).lean();
    res.json({ shares: shares.map((s) => shareView(req, s)) });
  } catch (error) { next(error); }
});

router.post('/shares', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    if (!isMarkdownSyncEnabled()) { res.status(403).json({ message: 'Markdown-delning är avstängd av administratören.' }); return; }
    const share = await MarkdownShare.create({
      userId,
      shareId: genShareId(),
      name: sanitizeName(req.body?.name) || 'Markdown-delning',
      folderIds: sanitizeIds(req.body?.folderIds),
      noteIds: sanitizeIds(req.body?.noteIds),
      modes: sanitizeModes(req.body?.modes),
      direction: sanitizeDirection(req.body?.direction),
      files: sanitizeFiles(req.body?.files),
      updatedAt: new Date(),
    });
    res.json(shareView(req, share));
  } catch (error) { next(error); }
});

router.put('/shares/:shareId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shareId = String(req.params.shareId || '');
    const share = await MarkdownShare.findOne({ userId, shareId });
    if (!share) { res.status(404).json({ message: 'Delningen finns inte.' }); return; }
    if (typeof req.body?.name === 'string') share.name = sanitizeName(req.body.name) || share.name;
    if (Array.isArray(req.body?.folderIds)) share.folderIds = sanitizeIds(req.body.folderIds);
    if (Array.isArray(req.body?.noteIds)) share.noteIds = sanitizeIds(req.body.noteIds);
    if (req.body?.modes) share.modes = sanitizeModes(req.body.modes) as any;
    if (req.body?.direction) share.direction = sanitizeDirection(req.body.direction) as any;
    if (Array.isArray(req.body?.files)) share.files = sanitizeFiles(req.body.files) as any;
    share.updatedAt = new Date();
    await share.save();
    res.json(shareView(req, share));
  } catch (error) { next(error); }
});

router.delete('/shares/:shareId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    await MarkdownShare.deleteOne({ userId, shareId: String(req.params.shareId || '') });
    res.json({ ok: true, shareId: req.params.shareId });
  } catch (error) { next(error); }
});

router.post('/shares/:shareId/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    if (!isMarkdownSyncEnabled()) { res.status(403).json({ message: 'Markdown-WebDAV är avstängt av administratören.' }); return; }
    const shareId = String(req.params.shareId || '');
    const share = await MarkdownShare.findOne({ userId, shareId });
    if (!share) { res.status(404).json({ message: 'Delningen finns inte.' }); return; }
    const username = share.davUser || genDavUser();
    const password = genDavPassword();
    share.davUser = username;
    share.davTokenHash = hashDavPassword(password);
    share.davCreatedAt = new Date();
    await share.save();
    res.json({ shareId, username, password, ...buildDavUrls(req, username) });
  } catch (error) { next(error); }
});

router.delete('/shares/:shareId/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    await MarkdownShare.updateOne(
      { userId, shareId: String(req.params.shareId || '') },
      { $set: { davUser: null, davTokenHash: null, davCreatedAt: null, davLastSeenAt: null, pendingMutations: [] } },
    );
    res.json({ ok: true, shareId: req.params.shareId });
  } catch (error) { next(error); }
});

// ---- CRDT (Phase 2) Live token ----
router.post('/shares/:shareId/crdt', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    if (!isMarkdownCrdtEnabled()) { res.status(403).json({ message: 'Live-läge (CRDT) är avstängt av administratören.' }); return; }
    const shareId = String(req.params.shareId || '');
    const share = await MarkdownShare.findOne({ userId, shareId });
    if (!share) { res.status(404).json({ message: 'Delningen finns inte.' }); return; }
    const token = genDavPassword();
    share.crdtTokenHash = hashDavPassword(token);
    share.modes = { webdav: share.modes?.webdav !== false, crdt: true } as any;
    await share.save();
    res.json({ shareId, token, wsUrl: crdtWsUrl(req, shareId) });
  } catch (error) { next(error); }
});

router.delete('/shares/:shareId/crdt', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shareId = String(req.params.shareId || '');
    const share = await MarkdownShare.findOne({ userId, shareId });
    if (share) {
      share.crdtTokenHash = null;
      share.modes = { webdav: share.modes?.webdav !== false, crdt: false } as any;
      await share.save();
    }
    res.json({ ok: true, shareId });
  } catch (error) { next(error); }
});

router.get('/mutations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shares = await MarkdownShare.find({ userId, 'pendingMutations.0': { $exists: true } }).lean();
    const mutations = shares.flatMap((s) =>
      (s.pendingMutations || []).map((m) => ({ ...m, shareId: s.shareId })),
    );
    mutations.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    res.json({ mutations });
  } catch (error) { next(error); }
});

router.post('/mutations/ack', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)).slice(0, 1000) : [];
    if (ids.length === 0) { res.json({ ok: true, removed: 0, requested: 0 }); return; }
    const removed = await ackPendingMutations(MarkdownShare, userId, ids);
    res.json({ ok: true, removed, requested: ids.length });
  } catch (error) { next(error); }
});

export default router;
