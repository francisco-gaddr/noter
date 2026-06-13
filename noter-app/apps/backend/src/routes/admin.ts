import express, { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Note from '../models/Note';
import Task from '../models/Task';
import AIConversationSync from '../models/AIConversationSync';
import AIMessageSync from '../models/AIMessageSync';

const router = express.Router();

// Mirrors healthDeep so the admin overview shows the same live posture without
// needing the internal health token (this route is JWT-scoped to the account).
const SERVICE_VERSION = process.env.npm_package_version || '1.2.0';
const SECURITY_LEVEL = process.env.SECURITY_LEVEL || 'v3-aes-gcm-argon2id';

/**
 * GET /api/admin/overview — account-scoped admin dashboard data: live server
 * health + version/security posture, plus the authenticated user's aggregate
 * counts. Everything is scoped by userId; there is no cross-tenant read here.
 */
router.get('/overview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const dbOk = mongoose.connection?.readyState === 1;

    const [notes, tasks, openTasks, aiConversations, aiMessages] = await Promise.all([
      Note.countDocuments({ userId }),
      Task.countDocuments({ userId }),
      // `completed` is an encrypted envelope, so "open" can't be computed server-side;
      // we expose total tasks and let the client derive open/overdue from plaintext.
      Task.countDocuments({ userId }),
      AIConversationSync.countDocuments({ userId }),
      AIMessageSync.countDocuments({ userId }),
    ]);

    res.json({
      server: {
        version: SERVICE_VERSION,
        securityLevel: SECURITY_LEVEL,
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        env: process.env.NODE_ENV || 'development',
      },
      db: { ok: dbOk, readyState: mongoose.connection?.readyState ?? 0 },
      counts: {
        notes,
        tasks,
        openTasks,
        aiConversations,
        aiMessages,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
