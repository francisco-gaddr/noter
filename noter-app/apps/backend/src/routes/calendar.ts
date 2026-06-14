import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { generateIcs, type CalendarFeedItem } from '@repo/shared';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import CalendarFeed from '../models/CalendarFeed';
import { UnauthorizedError } from '../utils/httpErrors';
import { genDavUser, genDavPassword, hashDavPassword } from '../caldav/credentials';
import { isIcsEnabled, isCaldavEnabled } from '../config/calendarExposure';

/**
 * Calendar (ICS) subscription.
 *
 *   GET  /api/calendar/:token.ics   PUBLIC, token-scoped — what a calendar app
 *                                   (Google/Apple) polls; no auth header possible.
 *   POST /api/calendar/subscription AUTH — mint/return the subscription URL (one
 *                                   token per user); optionally seed the items.
 *   PUT  /api/calendar/feed         AUTH — push the latest plaintext projection.
 *   DEL  /api/calendar/subscription AUTH — revoke (delete token + feed).
 *
 * Task titles/dates are E2E-encrypted, so the client pushes a minimal plaintext
 * projection (opt-in; it's going to an external calendar anyway). See CalendarFeed.
 */
const router = express.Router();

const baseHost = (req: Request): string =>
  (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const buildUrl = (req: Request, token: string): string => `${baseHost(req)}/api/calendar/${token}.ics`;

// CalDAV URLs the client shows the user. serverUrl is what most clients want (they
// do principal discovery from it); collectionUrl is the direct VTODO collection.
const buildDavUrls = (req: Request, davUser: string): { serverUrl: string; collectionUrl: string } => {
  const host = baseHost(req);
  return {
    serverUrl: `${host}/dav/`,
    collectionUrl: `${host}/dav/${encodeURIComponent(davUser)}/cal/tasks/`,
  };
};

// Normalise the scope: null = all-tasks feed; otherwise a task-list/project note id
// (validated to a safe id shape). 'all' / '' / null all map to the all-tasks feed.
const normalizeListId = (raw: unknown): string | null => {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || v === 'all') return null;
  return /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null;
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

// Public ICS feed. The token is the only credential; it's a 192-bit random secret.
router.get('/:token.ics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isIcsEnabled()) { res.status(404).send('Not found'); return; }
    const token = String(req.params.token || '');
    const feed = token ? await CalendarFeed.findOne({ token }).lean() : null;
    const ics = generateIcs((feed?.items as CalendarFeedItem[]) || []);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="noter-tasks.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(ics);
  } catch (error) {
    next(error);
  }
});

// List this user's calendar subscriptions (one per scope: all + each subscribed list).
router.get('/subscriptions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const feeds = await CalendarFeed.find({ userId }).lean();
    res.json({
      subscriptions: feeds.map((f) => ({
        listId: f.listId ?? null,
        token: f.token,
        url: buildUrl(req, f.token),
        count: Array.isArray(f.items) ? f.items.length : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Mint (or return existing) subscription URL for a scope (listId null = all tasks).
router.post('/subscription', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    if (!isIcsEnabled()) { res.status(403).json({ message: 'ICS-flödet är avstängt av administratören.' }); return; }
    const listId = normalizeListId(req.body?.listId);
    let feed = await CalendarFeed.findOne({ userId, listId });
    if (!feed) {
      const token = crypto.randomBytes(24).toString('base64url');
      feed = await CalendarFeed.create({ userId, listId, token, items: sanitizeItems(req.body?.items), updatedAt: new Date() });
    } else if (Array.isArray(req.body?.items)) {
      feed.items = sanitizeItems(req.body.items);
      feed.updatedAt = new Date();
      await feed.save();
    }
    res.json({ url: buildUrl(req, feed.token), token: feed.token, listId, count: feed.items.length });
  } catch (error) {
    next(error);
  }
});

// Push the latest projection for a scope (live updates). 404 if not subscribed yet.
router.put('/feed', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    if (!isIcsEnabled()) { res.status(403).json({ message: 'ICS-flödet är avstängt av administratören.' }); return; }
    const listId = normalizeListId(req.body?.listId);
    const items = sanitizeItems(req.body?.items);
    const feed = await CalendarFeed.findOneAndUpdate(
      { userId, listId },
      { $set: { items, updatedAt: new Date() } },
      { new: true },
    );
    if (!feed) {
      res.status(404).json({ message: 'No subscription; create one first.' });
      return;
    }
    res.json({ ok: true, listId, count: items.length });
  } catch (error) {
    next(error);
  }
});

// Revoke a scope: delete that feed/token. listId omitted/'all' = the all-tasks feed.
router.delete('/subscription', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const listId = normalizeListId(req.body?.listId ?? req.query?.listId);
    await CalendarFeed.deleteOne({ userId, listId });
    res.json({ ok: true, listId });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// CalDAV credential management. A CalDAV credential is a SEPARATE, revocable
// Basic-Auth secret bound to one feed scope. The password is shown ONCE and never
// stored (only its SHA-256). Revoking destroys CalDAV access for that scope without
// touching the public ICS feed. See caldav/server.ts for the protocol side.
// ---------------------------------------------------------------------------

const sanitizeDisplayName = (raw: unknown): string | null => {
  const v = typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
  return v || null;
};

// List the user's CalDAV-enabled scopes (never the password/hash).
router.get('/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const feeds = await CalendarFeed.find({ userId, davUser: { $ne: null } }).lean();
    res.json({
      credentials: feeds.map((f) => ({
        listId: f.listId ?? null,
        username: f.davUser,
        displayName: f.davDisplayName ?? null,
        createdAt: f.davCreatedAt ?? null,
        lastSeenAt: f.davLastSeenAt ?? null,
        ...buildDavUrls(req, f.davUser as string),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Mint (or rotate) a CalDAV credential for a scope. Creates the feed if missing and
// seeds items if provided. Returns the password exactly once.
router.post('/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    if (!isCaldavEnabled()) { res.status(403).json({ message: 'CalDAV är avstängt av administratören.' }); return; }
    const listId = normalizeListId(req.body?.listId);
    const displayName = sanitizeDisplayName(req.body?.displayName);
    let feed = await CalendarFeed.findOne({ userId, listId });
    if (!feed) {
      const token = crypto.randomBytes(24).toString('base64url');
      feed = await CalendarFeed.create({ userId, listId, token, items: sanitizeItems(req.body?.items), updatedAt: new Date() });
    } else if (Array.isArray(req.body?.items)) {
      feed.items = sanitizeItems(req.body.items);
      feed.updatedAt = new Date();
    }
    const username = feed.davUser || genDavUser();
    const password = genDavPassword();
    feed.davUser = username;
    feed.davTokenHash = hashDavPassword(password);
    feed.davDisplayName = displayName ?? feed.davDisplayName ?? null;
    feed.davCreatedAt = new Date();
    await feed.save();
    res.json({
      listId,
      username,
      password, // shown once — never returned again
      displayName: feed.davDisplayName ?? null,
      ...buildDavUrls(req, username),
    });
  } catch (error) {
    next(error);
  }
});

// Revoke a scope's CalDAV credential (instant). Keeps the ICS feed + items intact.
router.delete('/dav', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const listId = normalizeListId(req.body?.listId ?? req.query?.listId);
    await CalendarFeed.updateOne(
      { userId, listId },
      { $set: { davUser: null, davTokenHash: null, davDisplayName: null, davCreatedAt: null, davLastSeenAt: null, pendingMutations: [] } },
    );
    res.json({ ok: true, listId });
  } catch (error) {
    next(error);
  }
});

// Drain queue: pending CalDAV write-backs the client must apply with the user's key.
router.get('/mutations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const feeds = await CalendarFeed.find({ userId, 'pendingMutations.0': { $exists: true } }).lean();
    const mutations = feeds.flatMap((f) => (f.pendingMutations || []).map((m) => ({ ...m, feedListId: f.listId ?? null })));
    mutations.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    res.json({ mutations });
  } catch (error) {
    next(error);
  }
});

// Acknowledge applied mutations so they're removed from the queue.
router.post('/mutations/ack', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)).slice(0, 1000) : [];
    if (ids.length === 0) { res.json({ ok: true, removed: 0 }); return; }
    await CalendarFeed.updateMany(
      { userId },
      { $pull: { pendingMutations: { id: { $in: ids } } } },
    );
    res.json({ ok: true, removed: ids.length });
  } catch (error) {
    next(error);
  }
});

export default router;
