import express, { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import PushToken from '../models/PushToken';

const router = express.Router();

/**
 * POST /api/push/register — register (upsert) this device's Expo push token so the
 * backend can notify the user on all their devices (e.g. when an AI task starts /
 * finishes). Idempotent; one row per token, re-pointed to the current user.
 */
router.post('/register', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 16) : '';
    if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
      return res.status(400).json({ message: 'invalid push token' });
    }
    await PushToken.findOneAndUpdate(
      { token },
      { userId, token, platform, updatedAt: new Date().toISOString() },
      { upsert: true, new: true },
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/push/register — unregister this device's token (on logout). */
router.delete('/register', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (token) await PushToken.deleteOne({ token, userId });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
