import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { generateIcs, type CalendarFeedItem } from '@repo/shared';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import CalendarFeed from '../models/CalendarFeed';
import { UnauthorizedError } from '../utils/httpErrors';
import { genDavUser, genDavPassword, hashDavPassword } from '../caldav/credentials';
import { isIcsEnabled, isCaldavEnabled } from '../config/calendarExposure';
import { DAV_BASE } from '../caldav/base';

/**
 * Calendar/CalDAV SHARES ("delningar"). A share covers a SET of task-lists (or all)
 * under one ICS link + one CalDAV credential. Managed from Settings.
 *
 *   GET  /api/calendar/:token.ics      PUBLIC, token-scoped ICS for a share.
 *   GET  /api/calendar/shares          AUTH — list the user's shares.
 *   POST /api/calendar/shares          AUTH — create a share { name, listIds, items? }.
 *   PUT  /api/calendar/shares/:id      AUTH — update name/listIds and push items.
 *   DEL  /api/calendar/shares/:id      AUTH — delete a share (ICS + CalDAV).
 *   POST /api/calendar/shares/:id/dav  AUTH — mint/rotate the CalDAV credential (pw once).
 *   DEL  /api/calendar/shares/:id/dav  AUTH — revoke the CalDAV credential.
 *   GET  /api/calendar/mutations       AUTH — drain CalDAV write-backs.
 *   POST /api/calendar/mutations/ack   AUTH — ack applied mutations.
 *
 * Task data is E2E-encrypted; the client pushes a lock-aware plaintext projection
 * (union of the share's lists). See CalendarFeed + caldav/.
 */
const router = express.Router();

const baseHost = (req: Request): string =>
  (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const buildIcsUrl = (req: Request, token: string): string => `${baseHost(req)}/api/calendar/${token}.ics`;

const buildDavUrls = (req: Request, davUser: string): { serverUrl: string; collectionUrl: string } => {
  const host = baseHost(req);
  return {
    serverUrl: `${host}${DAV_BASE}/`,
    collectionUrl: `${host}${DAV_BASE}/${encodeURIComponent(davUser)}/cal/tasks/`,
  };
};

const genShareId = (): string => crypto.randomBytes(8).toString('hex');
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const sanitizeName = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().slice(0, 60) : '');

// A clean, de-duplicated set of valid task-list ids. Empty array = the all-tasks scope.
const sanitizeListIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && s !== 'all' && ID_RE.test(s)) out.add(s);
    if (out.size >= 500) break;
  }
  return [...out];
};

const sanitizeItems = (raw: unknown): CalendarFeedItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5000)
    .map((r: any): CalendarFeedItem => {
      const description = String(r?.description || '').slice(0, 4000);
      const priority = Number.isFinite(Number(r?.priority)) ? Math.max(0, Math.min(9, Math.round(Number(r.priority)))) : 0;
      return {
        uid: String(r?.uid || '').slice(0, 200),
        title: String(r?.title || '').slice(0, 500),
        start: String(r?.start || ''),
        allDay: r?.allDay !== false,
        completed: !!r?.completed,
        ...(description ? { description } : {}),
        ...(priority ? { priority } : {}),
      };
    })
    .filter((i) => i.uid && i.start);
};

const shareView = (req: Request, feed: any) => ({
  shareId: feed.shareId,
  name: feed.name || '',
  listIds: Array.isArray(feed.listIds) ? feed.listIds : [],
  icsUrl: buildIcsUrl(req, feed.token),
  count: Array.isArray(feed.items) ? feed.items.length : 0,
  dav: feed.davUser
    ? { username: feed.davUser, lastSeenAt: feed.davLastSeenAt ?? null, ...buildDavUrls(req, feed.davUser) }
    : null,
});

// ---- Public ICS feed (token is the only credential; 192-bit secret) ----
router.get('/:token.ics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isIcsEnabled()) { res.status(404).send('Not found'); return; }
    const token = String(req.params.token || '');
    const feed = token ? await CalendarFeed.findOne({ token }).lean() : null;
    const ics = generateIcs((feed?.items as CalendarFeedItem[]) || [], { calName: feed?.name || 'Noter – Uppgifter' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="noter-tasks.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(ics);
  } catch (error) {
    next(error);
  }
});

const requireUser = (req: AuthRequest): string => {
  const userId = req.user?.userId;
  if (!userId) throw new UnauthorizedError('Not authenticated');
  return userId;
};

// ---- List shares ----
router.get('/shares', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const feeds = await CalendarFeed.find({ userId }).lean();
    res.json({ shares: feeds.map((f) => shareView(req, f)) });
  } catch (error) {
    next(error);
  }
});

// ---- Create a share ----
router.post('/shares', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    if (!isIcsEnabled() && !isCaldavEnabled()) { res.status(403).json({ message: 'Delningar är avstängda av administratören.' }); return; }
    const name = sanitizeName(req.body?.name) || 'Delning';
    const listIds = sanitizeListIds(req.body?.listIds);
    const items = sanitizeItems(req.body?.items);
    const feed = await CalendarFeed.create({
      userId, shareId: genShareId(), name, listIds,
      token: crypto.randomBytes(24).toString('base64url'),
      items, updatedAt: new Date(),
    });
    res.json(shareView(req, feed));
  } catch (error) {
    next(error);
  }
});

// ---- Update a share (name/listIds) and push the latest projection ----
router.put('/shares/:shareId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shareId = String(req.params.shareId || '');
    const feed = await CalendarFeed.findOne({ userId, shareId });
    if (!feed) { res.status(404).json({ message: 'Delningen finns inte.' }); return; }
    if (typeof req.body?.name === 'string') feed.name = sanitizeName(req.body.name) || feed.name;
    if (Array.isArray(req.body?.listIds)) feed.listIds = sanitizeListIds(req.body.listIds);
    if (Array.isArray(req.body?.items)) feed.items = sanitizeItems(req.body.items) as any;
    feed.updatedAt = new Date();
    await feed.save();
    res.json(shareView(req, feed));
  } catch (error) {
    next(error);
  }
});

// ---- Delete a share (removes its ICS feed + CalDAV credential) ----
router.delete('/shares/:shareId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shareId = String(req.params.shareId || '');
    await CalendarFeed.deleteOne({ userId, shareId });
    res.json({ ok: true, shareId });
  } catch (error) {
    next(error);
  }
});

// ---- Mint / rotate the CalDAV credential for a share (password returned ONCE) ----
router.post('/shares/:shareId/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    if (!isCaldavEnabled()) { res.status(403).json({ message: 'CalDAV är avstängt av administratören.' }); return; }
    const shareId = String(req.params.shareId || '');
    const feed = await CalendarFeed.findOne({ userId, shareId });
    if (!feed) { res.status(404).json({ message: 'Delningen finns inte.' }); return; }
    const username = feed.davUser || genDavUser();
    const password = genDavPassword();
    feed.davUser = username;
    feed.davTokenHash = hashDavPassword(password);
    feed.davCreatedAt = new Date();
    await feed.save();
    res.json({ shareId, username, password, ...buildDavUrls(req, username) });
  } catch (error) {
    next(error);
  }
});

// ---- Revoke a share's CalDAV credential (ICS feed stays) ----
router.delete('/shares/:shareId/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const shareId = String(req.params.shareId || '');
    await CalendarFeed.updateOne(
      { userId, shareId },
      { $set: { davUser: null, davTokenHash: null, davCreatedAt: null, davLastSeenAt: null, pendingMutations: [] } },
    );
    res.json({ ok: true, shareId });
  } catch (error) {
    next(error);
  }
});

// ---- Drain queue: CalDAV write-backs to apply with the user's key ----
router.get('/mutations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const feeds = await CalendarFeed.find({ userId, 'pendingMutations.0': { $exists: true } }).lean();
    const mutations = feeds.flatMap((f) => (f.pendingMutations || []).map((m) => ({ ...m, shareId: f.shareId })));
    mutations.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    res.json({ mutations });
  } catch (error) {
    next(error);
  }
});

router.post('/mutations/ack', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)).slice(0, 1000) : [];
    if (ids.length === 0) { res.json({ ok: true, removed: 0 }); return; }
    await CalendarFeed.updateMany({ userId }, { $pull: { pendingMutations: { id: { $in: ids } } } });
    res.json({ ok: true, removed: ids.length });
  } catch (error) {
    next(error);
  }
});

export default router;
