/**
 * GDPR account routes: data export (right of access / portability, Art. 15/20) and account deletion
 * (right to erasure, Art. 17). Both are user-scoped via authMiddleware (a user can only ever export
 * or delete their OWN data — userId comes from the token, never the body). Deletion requires
 * re-typing the username to confirm (guards against accidental/CSRF erasure), and is logged.
 */
import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import { exportUserData, deleteUserData } from '../services/userData';
import logger from '../utils/logger';

const router = express.Router();

const requireUser = (req: Request): string => {
  const userId = (req as AuthRequest).user?.userId;
  if (!userId) {
    const e = new Error('Unauthorized') as Error & { status?: number };
    e.status = 401;
    throw e;
  }
  return userId;
};

// GET /api/account/export — download everything we hold for the authenticated user.
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const data = await exportUserData(userId);
    logger.info('account.export', { userId });
    res.setHeader('Content-Disposition', 'attachment; filename="noter-data-export.json"');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

const deleteSchema = Joi.object({ confirmUsername: Joi.string().required() });

// DELETE /api/account — permanently erase the authenticated user's account + all their data.
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const { error, value } = deleteSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({ message: 'confirmUsername krävs för att bekräfta radering.' });
      return;
    }
    const user = await User.findById(userId).lean();
    if (!user) {
      res.status(404).json({ message: 'Konto hittades inte.' });
      return;
    }
    // Confirmation: the supplied name must match the account's username (case-insensitive).
    if (String(value.confirmUsername).trim().toLowerCase() !== String(user.username).toLowerCase()) {
      res.status(400).json({ message: 'Bekräftelsenamnet matchar inte ditt användarnamn.' });
      return;
    }
    const summary = await deleteUserData(userId);
    logger.warn('account.deleted', { userId, totalDeleted: summary.totalDeleted });
    res.json({ ok: true, ...summary });
  } catch (error) {
    next(error);
  }
});

export default router;
