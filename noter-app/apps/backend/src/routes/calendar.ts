import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { generateIcs, type CalendarFeedItem } from '@repo/shared';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import CalendarFeed from '../models/CalendarFeed';
import { UnauthorizedError } from '../utils/httpErrors';

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

const buildUrl = (req: Request, token: string): string => {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/calendar/${token}.ics`;
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
    .map((r: any): CalendarFeedItem => ({
      uid: String(r?.uid || '').slice(0, 200),
      title: String(r?.title || '').slice(0, 500),
      start: String(r?.start || ''),
      allDay: r?.allDay !== false,
      completed: !!r?.completed,
    }))
    .filter((i) => i.uid && i.start);
};

// Public ICS feed. The token is the only credential; it's a 192-bit random secret.
router.get('/:token.ics', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

export default router;
