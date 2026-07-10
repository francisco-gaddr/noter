import express, { Request, Response, NextFunction } from 'express';
import Note from '../models/Note';
import Task from '../models/Task';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { createRateLimit, createLockoutLimiter } from '../middleware/rateLimit';
import { decrypt, encrypt } from '@repo/shared';
import { AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import cache from '../services/cache';
import { isEncryptedPayload } from '../utils/encryption';
import { parsePageParams, buildCursorFilter, buildPage } from '../utils/pagination';
import { runWithReadPreference } from '../utils/readPreference';
import logger from '../utils/logger';

const router = express.Router();

// bcrypt work factor for note-lock passwords. OWASP Password Storage Cheat Sheet (2025)
// recommends >= 12 (cost 12 ~= 250 ms/hash on a modern server); bumped from the old default 10.
// Existing lower-cost hashes keep verifying — bcrypt encodes the cost in the hash, so a re-lock
// silently upgrades them.
const LOCK_PASSWORD_BCRYPT_COST = 12;

const encryptedRequired = Joi.string().custom((value, helpers) => (
  isEncryptedPayload(value) ? value : helpers.error('any.invalid')
));
const encryptedOptional = Joi.alternatives().try(Joi.string().valid(''), encryptedRequired);

const parseEncryptedBoolean = (value: string): boolean => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const decrypted = decrypt(value);
  if (decrypted === 'true') return true;
  if (decrypted === 'false') return false;
  return false;
};

// Validation schemas
const noteSchema = Joi.object({
  title: encryptedRequired.required(),
  content: encryptedRequired.required(),
  tags: Joi.array().items(encryptedRequired).max(200),
  parentId: Joi.string().allow(null),
  locked: encryptedOptional.optional(),
  password: encryptedOptional.optional(),
  icon: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  order: encryptedOptional.optional(),
  type: encryptedRequired.required(),
  links: encryptedOptional.optional(),
  source: encryptedOptional.optional(),
  // Per-folder crypto bundle (ADR-0012): a serialized FolderKeyBundle, NOT a content ciphertext —
  // it carries no secret without the folder password, so it is a plain string (not encryptedOptional).
  folderKeyBundle: Joi.string().allow('').optional(),
  clientId: Joi.string().allow('').optional(),
  createdAt: encryptedRequired.required(),
  updatedAt: encryptedRequired.required()
});

const updateSchema = Joi.object({
  title: encryptedRequired.optional(),
  content: encryptedRequired.optional(),
  tags: Joi.array().items(encryptedRequired).max(200).optional(),
  parentId: Joi.string().allow(null),
  locked: encryptedOptional.optional(),
  password: encryptedOptional.optional(),
  icon: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  order: encryptedOptional.optional(),
  type: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  links: encryptedOptional.optional(),
  source: encryptedOptional.optional(),
  folderKeyBundle: Joi.string().allow('').optional(), // serialized FolderKeyBundle (ADR-0012), plain (no secret)
  createdAt: encryptedOptional.optional(),
  updatedAt: encryptedOptional.optional()
});

const reorderSchema = Joi.object({
  notes: Joi.array()
    .items(
      Joi.object({
        _id: Joi.string().required(),
        order: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).required(),
      }).unknown(true),
    )
    .required(),
});

// Redis-backed (with in-memory fallback) limiter — 25 attempts / 10 min.
// Uses the shared createRateLimit wrapper so unlock attempts are rate-limited
// consistently across multiple backend instances, not just per-process.
const verifyLockLimiter = createRateLimit({
  keyPrefix: 'verify-lock',
  points: 25,
  durationSec: 10 * 60,
  message: 'Too many unlock verification attempts, please try again later.'
});

// Per-(user, note) lockout layered ON TOP of the coarse IP limiter above. The IP limiter alone
// lets an attacker spread guesses across many notes (different :id) inside one global budget;
// this counts CONSECUTIVE failed guesses for a single note and blocks that note for the user
// after the threshold, auto-reopening after the cool-down (OWASP A07:2025 account lockout). A
// correct password resets the counter immediately.
const verifyLockLockout = createLockoutLimiter({
  keyPrefix: 'verify-lock-fail',
  maxFailures: 5,
  windowSec: 15 * 60,
  blockSec: 15 * 60,
});

// GET /api/notes
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;

    // Pagination is OPT-IN per request: callers that send ?limit= or
    // ?cursor= get a paginated envelope; callers that send neither get
    // the historical full-list response (back-compat for the existing
    // mobile + web clients that don't yet read nextCursor).
    const wantsPagination = typeof req.query.limit !== 'undefined' || typeof req.query.cursor !== 'undefined';
    if (wantsPagination) {
      const { limit, cursor } = parsePageParams(req.query as Record<string, unknown>);
      const filter = { userId, ...buildCursorFilter(cursor, 'desc') };
      // Read from a secondary when the cluster offers one. The note-list
      // path tolerates a few seconds of replication lag (we don't ask for
      // "give me the note I just wrote"; reads-after-write hit the
      // by-id route below which stays on primary).
      const query = Note.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
      runWithReadPreference(query, 'secondaryPreferred');
      const rows = await query;
      const page = buildPage(rows.map((n) => n.toObject()) as Array<{ _id: { toString(): string }; createdAt: string }>, limit);
      res.json(page);
      return;
    }

    const cacheKey = `notes:list:${userId}`;
    const cachedNotes = await cache.get(cacheKey);

    if (cachedNotes) {
      res.json(cachedNotes);
      return;
    }

    // Abuse/OOM guard, deliberately HIGH: clients reconcile their local store against this
    // response as the complete set, so a low cap could make them drop local notes. 10k bounds a
    // pathological account without touching any realistic library; heavier clients paginate.
    // .lean(): plain objects instead of hydrated documents — this is a read-only serialize path.
    const notes = await Note.find({ userId: (req as AuthRequest).user!.userId })
      .sort({ createdAt: -1 })
      .limit(10_000)
      .lean();

    // Early return if no notes
    if (notes.length === 0) {
      res.json([]);
      return;
    }

    // Since locked is E2E encrypted we cannot determine lock status server-side; the client
    // handles lock logic and decryption. Lean docs are already plain objects.
    const sanitizedNotes = notes;

    await cache.set(cacheKey, sanitizedNotes, 300); // Cache for 5 minutes
    res.json(sanitizedNotes);
  } catch (error) {
    next(error);
  }
});

import mongoose from 'mongoose';

// GET /api/notes/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      return next(new Error('Invalid ID format'));
    }
    const userId = (req as AuthRequest).user!.userId;
    const cacheKey = `notes:item:${userId}:${req.params.id}`;
    const cachedNote = await cache.get(cacheKey);
    if (cachedNote) {
      res.json(cachedNote);
      return;
    }
    // Scope by userId — an unscoped findById here would let any authenticated
    // user read another user's note content and password hash by guessing the id.
    const note = await Note.findOne({ _id: req.params.id, userId }).select('+password');
    if (!note) {
      res.status(404);
      return next(new Error('Note not found'));
    }
    // We don't hide content here because this endpoint might be used for sync/edit
    // But if it's locked, we should probably hide content unless password provided?
    // For sync purposes, we need metadata (updatedAt).
    // Let's return full note but maybe clear content if locked?
    // The GET / logic clears content.
    // However, if we are syncing, we might want to know if we have a conflict.
    // If the client has the password, they can unlock it.
    // For now, let's behave like GET / and hide content if locked.
    
    // Actually, for simple sync check, we mostly care about updatedAt.
    const noteObj = note.toObject();
    
    // Check if locked (simplified check, not recursive for single note efficiency, but inaccurate)
    // To be consistent, we should use the same logic or just return it.
    // Let's just return it. The client handles decryption/locking view.
    // But wait, GET / hides content.
    await cache.set(cacheKey, noteObj, 300);
    res.json(noteObj);
  } catch (error) {
    next(error);
  }
});

// POST /api/notes/:id/verify-lock
router.post('/:id/verify-lock', verifyLockLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const targetId = req.params.id;
    const lockoutKey = `${userId}:${targetId}`;
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;

    // Lockout gate: if this user has burned through the failure budget for this note, refuse
    // until the cool-down elapses — before we touch the DB or compare anything.
    const lock = await verifyLockLockout.check(lockoutKey);
    if (lock.blocked) {
      logger.warn('verifyLock.lockout', { userId, noteId: targetId, ip: clientIp, retryAfterSec: lock.retryAfterSec });
      res.setHeader('Retry-After', String(lock.retryAfterSec));
      res.status(429).json({ success: false, message: 'För många försök. Försök igen senare.', retryAfterSec: lock.retryAfterSec });
      return;
    }

    const targetNote = await Note.findOne({ _id: targetId, userId }).select('+password');

    if (!targetNote) {
      res.status(404);
      return next(new Error('Note not found'));
    }

    let blockingNote: any = null;
    let current: any = targetNote;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(String(current._id))) break;
      seen.add(String(current._id));
      const lockedRaw = String(current.locked ?? '');
      const isLocked = parseEncryptedBoolean(lockedRaw);
      if (isLocked) {
        blockingNote = current;
        break;
      }
      if (!current.parentId) break;
      current = await Note.findOne({ _id: current.parentId, userId }).select('+password');
    }

    if (!blockingNote) {
      res.json({ success: true, content: targetNote.content, title: targetNote.title, unlockedId: null });
      return;
    }

    // Record a failed unlock attempt: bump the per-(user,note) lockout counter, audit-log it
    // (failed attempts return 200 success:false, so the response-status audit middleware wouldn't
    // otherwise see them), and write the response — 429 + Retry-After once this failure crosses
    // the threshold, otherwise the usual 200 success:false (kept so the frontend doesn't log out).
    const failAttempt = async (): Promise<void> => {
      const r = await verifyLockLockout.registerFailure(lockoutKey);
      logger.warn('verifyLock.failed', { userId, noteId: targetId, ip: clientIp, nowBlocked: r.blocked });
      if (r.blocked) {
        res.setHeader('Retry-After', String(r.retryAfterSec));
        res.status(429).json({ success: false, message: 'För många försök. Försök igen senare.', retryAfterSec: r.retryAfterSec });
        return;
      }
      res.json({ success: false, message: 'Invalid password' });
    };

    const password = req.body?.password;
    if (!password || !blockingNote.password) {
      await failAttempt();
      return;
    }

    const decryptedCandidate = decrypt(password);
    const encryptedCandidate = encrypt(password);
    const candidates = [password, decryptedCandidate, encryptedCandidate].filter((v, i, arr) => v && arr.indexOf(v) === i);
    let isMatch = false;
    for (const candidate of candidates) {
      if (await bcrypt.compare(candidate, blockingNote.password)) {
        isMatch = true;
        break;
      }
    }
    if (!isMatch) {
      await failAttempt();
      return;
    }

    // Correct password — clear the failure counter so a legitimate user is never penalised by
    // earlier typos.
    await verifyLockLockout.reset(lockoutKey);
    res.json({ success: true, content: targetNote.content, title: targetNote.title, unlockedId: String(blockingNote._id) });
  } catch (error) {
    next(error);
  }
});

// POST /api/notes
router.post('/', validate(noteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteData = { ...req.body, userId };

    // Deduplication check
    if (noteData.clientId) {
      const existingNote = await Note.findOne({ userId, clientId: noteData.clientId });
      if (existingNote) {
         // Idempotent success - return existing
         res.status(200).json(existingNote);
         return;
      }
    }

    if (noteData.password) {
      const decrypted = decrypt(noteData.password);
      const rawPassword = decrypted ? decrypted : noteData.password;
      noteData.password = await bcrypt.hash(rawPassword, LOCK_PASSWORD_BCRYPT_COST);
    }

    const note = new Note(noteData);
    const createdNote = await note.save();
    
    await cache.del(`notes:list:${userId}`);

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('note:created', createdNote);

    res.status(201).json(createdNote);
  } catch (error: any) {
    // Concurrent duplicate create (double-tap / client retry): both requests pass the findOne
    // dedup check, the second save hits the unique {userId, clientId} index. Idempotent success —
    // return the existing note instead of a 500 (mirrors the tasks route).
    if (error.code === 11000 && error.keyPattern?.clientId) {
      const existingNote = await Note.findOne({
        userId: (req as AuthRequest).user!.userId,
        clientId: req.body.clientId,
      });
      if (existingNote) {
        res.status(200).json(existingNote);
        return;
      }
    }
    next(error);
  }
});

// PUT /api/notes/reorder
router.put('/reorder', validate(reorderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = req.body as { notes: Array<{ _id: string; order: number }> };
    const userId = (req as AuthRequest).user!.userId;

    const updates = notes
      .filter((n) => mongoose.Types.ObjectId.isValid(n._id))
      .map((n: any) => {
        const updateSet: any = { order: n.order };
        if (n.parentId !== undefined) {
          updateSet.parentId = n.parentId;
        }
        return {
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(n._id), userId },
            update: { $set: updateSet },
          },
        };
      });

    if (updates.length > 0) {
      await Note.bulkWrite(updates);
    }

    await cache.del(`notes:list:${userId}`);

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('notes:reordered', notes);

    res.json({ message: 'Notes reordered' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notes/:id
router.put('/:id', validate(updateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const value = req.body;
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      return next(new Error('Invalid ID format'));
    }
    // Scope by userId — without it any authenticated user could update another
    // user's note by guessing its id (IDOR / broken access control).
    const userId = (req as AuthRequest).user!.userId;
    const note = await Note.findOne({ _id: req.params.id, userId });

    if (note) {
      if (value.title !== undefined) note.title = value.title;
      if (value.content !== undefined) note.content = value.content;
      if (value.tags !== undefined) note.tags = value.tags;
      if (value.parentId !== undefined) note.parentId = value.parentId;
      if (value.locked !== undefined) {
        const nextLockedEncrypted = String(value.locked);
        const nextLocked = parseEncryptedBoolean(nextLockedEncrypted);
        const currentLocked = parseEncryptedBoolean(String(note.locked || ''));
        if (currentLocked && !nextLocked) {
          res.status(403);
          return next(new Error('Unlock is not allowed through update endpoint'));
        }
        note.locked = nextLockedEncrypted;
      }
      if (value.type !== undefined) note.type = value.type;
      if (value.password !== undefined) {
        if (value.password) {
            const decrypted = decrypt(value.password);
            const rawPassword = decrypted ? decrypted : value.password;
            note.password = await bcrypt.hash(rawPassword, LOCK_PASSWORD_BCRYPT_COST);
        } else {
            note.password = '';
        }
      }
      if (value.icon !== undefined) note.icon = value.icon;
      if ((value as any).links !== undefined) (note as any).links = (value as any).links;
      if ((value as any).source !== undefined) (note as any).source = (value as any).source;
      if ((value as any).folderKeyBundle !== undefined) (note as any).folderKeyBundle = (value as any).folderKeyBundle;
      if (value.order !== undefined) note.order = value.order;
      if (value.createdAt !== undefined) note.createdAt = value.createdAt; // Handle encrypted timestamps
      if (value.updatedAt !== undefined) note.updatedAt = value.updatedAt; // Handle encrypted timestamps

      const updatedNote = await note.save();
      
      const userId = (req as AuthRequest).user!.userId;
      await cache.del(`notes:list:${userId}`);
      await cache.del(`notes:item:${userId}:${req.params.id}`);

      const noteObj = updatedNote.toObject();
      
      const io = req.app.get('io');
      io.to(`user:${userId}`).emit('note:updated', noteObj);

      res.json(noteObj);
    } else {
      res.status(404);
      return next(new Error('Note not found'));
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      return next(new Error('Invalid ID format'));
    }
    const userId = (req as AuthRequest).user!.userId;
    const note = await Note.findOne({ _id: req.params.id, userId });

    if (note) {
      // Cascade-delete any child tasks. `note.type` is stored ENCRYPTED at rest
      // (the backend is zero-knowledge and can't decrypt E2E content), so we can't
      // branch on a plaintext `=== 'task_list'` comparison. Instead we always attempt
      // the cascade keyed on the non-encrypted `parentNoteId` signal: a plain note has
      // no child tasks, so this is a safe no-op for everything except task lists.
      const tasks = await Task.find({ userId, parentNoteId: note._id }).select('_id');
      const deletedTaskIds: string[] = tasks.map(t => t._id.toString());
      if (deletedTaskIds.length > 0) {
        await Task.deleteMany({ userId, parentNoteId: note._id });
      }

      await note.deleteOne();
      
      await cache.del(`notes:list:${userId}`);
      await cache.del(`notes:item:${userId}:${req.params.id}`);
      const io = req.app.get('io');
      io.to(`user:${userId}`).emit('note:deleted', req.params.id);
      for (const taskId of deletedTaskIds) {
        io.to(`user:${userId}`).emit('task:deleted', taskId);
      }

      res.json({ message: 'Note removed' });
    } else {
      res.status(404);
      return next(new Error('Note not found'));
    }
  } catch (error) {
    next(error);
  }
});

export default router;
