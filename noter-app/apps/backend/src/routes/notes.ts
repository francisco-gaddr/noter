import { randomBytes } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import Note from '../models/Note';
import Task from '../models/Task';
import DeletionTombstone from '../models/DeletionTombstone';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { decrypt } from '@repo/shared';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import cache from '../services/cache';
import { isEncryptedPayload } from '../utils/encryption';
import { assertValidObjectId, findOwnedById } from '../utils/ownedQuery';

const router = express.Router();
const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
const omitSensitiveNoteFields = <T extends Record<string, any>>(note: T) => {
  const { password, ...rest } = note;
  return rest;
};

const encryptedRequired = Joi.string().custom((value, helpers) => (
  isEncryptedPayload(value) ? value : helpers.error('any.invalid')
));
const encryptedOptional = Joi.alternatives().try(Joi.string().valid(''), encryptedRequired);

const normalizePasswordInput = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (value === '') return '';
  const normalized = decrypt(value);
  if (isEncryptedPayload(value) && normalized === '') return null;
  return normalized;
};

const parseIsoDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const resolveStoredUpdatedAt = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const direct = parseIsoDate(value);
  if (direct) return direct;
  try {
    return parseIsoDate(decrypt(value));
  } catch {
    return null;
  }
};

const filterNotesChangedSince = <T extends { updatedAt?: unknown }>(items: T[], since: string | null) => {
  if (!since) return items;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return items;
  return items.filter((item) => {
    const updatedAt = resolveStoredUpdatedAt(item.updatedAt);
    if (!updatedAt) return true;
    return Date.parse(updatedAt) > sinceMs;
  });
};

const filterDeletedIdsSince = async (
  userId: string,
  entity: 'NOTE' | 'TASK',
  since: string | null,
) => {
  const query: Record<string, unknown> = { userId, entity };
  if (since) {
    query.deletedAt = { $gt: new Date(since) };
  }
  const tombstones = await DeletionTombstone.find(query)
    .sort({ deletedAt: -1 })
    .select('itemId')
    .lean()
    .exec();
  return Array.from(new Set(tombstones.map((item: any) => String(item.itemId)).filter(Boolean)));
};

const parseStoredNoteType = (value: unknown): 'note' | 'task_list' | 'project' => {
  if (typeof value !== 'string') return 'note';
  const normalize = (raw: string): 'note' | 'task_list' | 'project' => (
    raw === 'task_list' || raw === 'project' ? raw : 'note'
  );
  try {
    return normalize(decrypt(value));
  } catch {
    return normalize(value);
  }
};

const getTaskListCacheKey = (userId: string, parentNoteId?: string | null) => (
  parentNoteId ? `tasks:list:${userId}:note:${parentNoteId}` : `tasks:list:${userId}:all`
);

const getTaskCacheKeys = (userId: string, parentNoteIds: Array<string | null | undefined>) => (
  Array.from(new Set([
    getTaskListCacheKey(userId),
    ...parentNoteIds.map((parentNoteId) => getTaskListCacheKey(userId, parentNoteId ?? undefined)),
  ]))
);

const collectOwnedNoteCascade = async (userId: string, rootNote: { _id: mongoose.Types.ObjectId | string; type?: unknown }) => {
  const noteIds: string[] = [];
  const taskListIds = new Set<string>();
  const seen = new Set<string>();
  let frontier = [String(rootNote._id)];

  while (frontier.length > 0) {
    frontier = frontier.filter((id) => mongoose.Types.ObjectId.isValid(id) && !seen.has(id));
    if (frontier.length === 0) break;
    frontier.forEach((id) => {
      seen.add(id);
      noteIds.push(id);
    });

    const currentType = frontier.length === 1 && frontier[0] === String(rootNote._id)
      ? parseStoredNoteType(rootNote.type)
      : null;
    if (currentType === 'task_list') {
      taskListIds.add(String(rootNote._id));
    }

    const objectIds = frontier.map((id) => new mongoose.Types.ObjectId(id));
    const children = await Note.find({ userId, parentId: { $in: objectIds } })
      .select('_id type')
      .lean()
      .exec();

    frontier = [];
    children.forEach((child: any) => {
      const childId = String(child._id);
      if (seen.has(childId)) return;
      if (parseStoredNoteType(child.type) === 'task_list') {
        taskListIds.add(childId);
      }
      frontier.push(childId);
    });
  }

  if (parseStoredNoteType(rootNote.type) === 'task_list') {
    taskListIds.add(String(rootNote._id));
  }

  return {
    noteIds,
    taskListIds: Array.from(taskListIds),
  };
};

// Validation schemas
const noteSchema = Joi.object({
  title: encryptedRequired.required(),
  content: encryptedRequired.required(),
  tags: Joi.array().items(encryptedRequired),
  parentId: Joi.string().allow(null),
  locked: encryptedOptional.optional(),
  password: encryptedOptional.optional(),
  icon: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  order: encryptedOptional.optional(),
  type: encryptedRequired.required(),
  clientId: Joi.string().allow('').optional(),
  createdAt: encryptedRequired.required(),
  updatedAt: encryptedRequired.required()
});

const updateSchema = Joi.object({
  clientMutationId: Joi.string().max(128).optional(),
  baseUpdatedAt: Joi.string().isoDate().optional(),
  title: encryptedRequired.optional(),
  content: encryptedRequired.optional(),
  tags: Joi.array().items(encryptedRequired).optional(),
  parentId: Joi.string().allow(null),
  locked: encryptedOptional.optional(),
  password: encryptedOptional.optional(),
  unlockPassword: Joi.string().optional(),
  icon: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  order: encryptedOptional.optional(),
  type: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
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
    .max(1000)
    .required(),
});

const bulkSyncSchema = Joi.object({
  operations: Joi.array().items(
    Joi.object({
      clientOperationId: Joi.string().max(128).required(),
      action: Joi.string().valid('CREATE', 'UPDATE', 'DELETE').required(),
      id: Joi.string().optional(),
      tempId: Joi.string().optional(),
      data: Joi.object().unknown(true).optional(),
    }).required(),
  ).min(1).max(250).required(),
});

const verifyLockLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many unlock verification attempts, please try again later.'
});

const createNoteRecord = async (userId: string, noteData: any, io: any) => {
  const payload = { ...noteData, userId };
  if (payload.clientId) {
    const existingNote = await Note.findOne({ userId, clientId: payload.clientId });
    if (existingNote) {
      return omitSensitiveNoteFields(existingNote.toObject());
    }
  }

  if (payload.password !== undefined) {
    const rawPassword = normalizePasswordInput(payload.password);
    if (rawPassword === null || rawPassword.length === 0) {
      const error: any = new Error('Invalid encrypted password payload');
      error.status = 400;
      throw error;
    }
    payload.password = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);
    payload.locked = 'true';
  }

  const note = new Note(payload);
  const createdNote = await note.save();
  const createdObj = omitSensitiveNoteFields(createdNote.toObject());
  await cache.del(`notes:list:${userId}`);
  io.to(`user:${userId}`).emit('note:created', createdObj);
  return createdObj;
};

const updateNoteRecord = async (userId: string, noteId: string, value: any, io: any) => {
  const note = await findOwnedById(Note, userId, noteId).select('+password');
  if (!note) {
    return { status: 'not_found' as const };
  }

  const baseUpdatedAt = parseIsoDate(value.baseUpdatedAt);
  const currentUpdatedAt = resolveStoredUpdatedAt(note.updatedAt);
  if (baseUpdatedAt && currentUpdatedAt && baseUpdatedAt !== currentUpdatedAt) {
    const sanitizedNote = omitSensitiveNoteFields(note.toObject());
    return {
      status: 'conflict' as const,
      conflict: {
        message: 'Note has changed on another device',
        code: 'SYNC_CONFLICT',
        entity: 'NOTE',
        itemId: note._id.toString(),
        localBaseUpdatedAt: baseUpdatedAt,
        serverUpdatedAt: currentUpdatedAt,
        conflictFields: ['updatedAt'],
        item: sanitizedNote,
        serverItem: sanitizedNote,
      },
    };
  }

  if (value.title !== undefined) note.title = value.title;
  if (value.content !== undefined) note.content = value.content;
  if (value.tags !== undefined) note.tags = value.tags;
  if (value.parentId !== undefined) note.parentId = value.parentId;
  if (value.type !== undefined) note.type = value.type;
  if (value.password !== undefined) {
    if (typeof value.password === 'string' && value.password.length > 0) {
      const rawPassword = normalizePasswordInput(value.password);
      if (rawPassword === null || rawPassword.length === 0) {
        const error: any = new Error('Invalid encrypted password payload');
        error.status = 400;
        throw error;
      }
      note.password = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);
      note.locked = 'true';
    } else {
      const currentlyProtected = typeof note.password === 'string' && note.password.length > 0;
      if (currentlyProtected) {
        const unlockPassword = normalizePasswordInput(value.unlockPassword);
        if (unlockPassword === null || unlockPassword.length === 0) {
          await bcrypt.compare(typeof value.unlockPassword === 'string' ? value.unlockPassword : '', DUMMY_PASSWORD_HASH);
          const error: any = new Error('Invalid password');
          error.status = 403;
          throw error;
        }
        const isMatch = await bcrypt.compare(unlockPassword, note.password);
        if (!isMatch) {
          const error: any = new Error('Invalid password');
          error.status = 403;
          throw error;
        }
      }
      note.password = '';
      note.locked = 'false';
    }
  }
  if (value.icon !== undefined) note.icon = value.icon;
  if (value.order !== undefined) note.order = value.order;
  if (value.createdAt !== undefined) note.createdAt = value.createdAt;
  if (value.updatedAt !== undefined) note.updatedAt = value.updatedAt;

  const updatedNote = await note.save();
  await cache.del(`notes:list:${userId}`);
  await cache.del(`notes:item:${userId}:${noteId}`);
  const noteObj = omitSensitiveNoteFields(updatedNote.toObject());
  io.to(`user:${userId}`).emit('note:updated', noteObj);
  return { status: 'applied' as const, item: noteObj };
};

const deleteNoteRecord = async (userId: string, noteId: string, io: any) => {
  const note = await findOwnedById(Note, userId, noteId);
  if (!note) {
    return { status: 'not_found' as const };
  }

  const { noteIds, taskListIds } = await collectOwnedNoteCascade(userId, note as any);
  const deletedTaskIds = taskListIds.length > 0
    ? (await Task.find({
      userId,
      parentNoteId: { $in: taskListIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select('_id').lean().exec()).map((task) => String(task._id))
    : [];
  const deletionTimestamp = new Date();

  await Promise.all([
    Note.deleteMany({ userId, _id: { $in: noteIds.map((id) => new mongoose.Types.ObjectId(id)) } }),
    taskListIds.length > 0
      ? Task.deleteMany({
        userId,
        parentNoteId: { $in: taskListIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
      : Promise.resolve(),
    noteIds.length > 0
      ? DeletionTombstone.bulkWrite(noteIds.map((id) => ({
        updateOne: {
          filter: { userId, entity: 'NOTE', itemId: id },
          update: {
            $set: {
              userId,
              entity: 'NOTE',
              itemId: id,
              deletedAt: deletionTimestamp,
            },
          },
          upsert: true,
        },
      })))
      : Promise.resolve(),
    deletedTaskIds.length > 0
      ? DeletionTombstone.bulkWrite(deletedTaskIds.map((id) => ({
        updateOne: {
          filter: { userId, entity: 'TASK', itemId: id },
          update: {
            $set: {
              userId,
              entity: 'TASK',
              itemId: id,
              deletedAt: deletionTimestamp,
            },
          },
          upsert: true,
        },
      })))
      : Promise.resolve(),
  ]);

  await cache.del(`notes:list:${userId}`);
  await cache.delMany(noteIds.map((id) => `notes:item:${userId}:${id}`));
  await cache.delMany(getTaskCacheKeys(userId, taskListIds));
  for (const deletedNoteId of noteIds) {
    io.to(`user:${userId}`).emit('note:deleted', deletedNoteId);
  }
  for (const taskId of deletedTaskIds) {
    io.to(`user:${userId}`).emit('task:deleted', taskId);
  }

  return { status: 'applied' as const, deletedNoteIds: noteIds, deletedTaskIds };
};

// GET /api/notes
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const cacheKey = `notes:list:${userId}`;
    const cachedNotes = await cache.get(cacheKey);

    if (cachedNotes) {
      res.json(cachedNotes);
      return;
    }

    const notes = await Note.find({ userId: (req as AuthRequest).user!.userId }).sort({ createdAt: -1 }).lean().exec();
    
    // Early return if no notes
    if (notes.length === 0) {
      res.json([]);
      return;
    }
    
    // Since locked is now E2E encrypted, we cannot determine lock status on the server
    // The client handles lock logic and decryption. We return all notes as-is.
    const sanitizedNotes = notes.map((note) => ({
      ...note,
      // Note: Content hiding for locked notes is now handled client-side
      // since we cannot decrypt the locked field server-side
    }));

    await cache.set(cacheKey, sanitizedNotes, 300); // Cache for 5 minutes
    res.json(sanitizedNotes);
  } catch (error) {
    next(error);
  }
});

// GET /api/notes/changes?since=ISO_DATE
router.get('/changes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const since = parseIsoDate(req.query.since);
    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : null;
    if (rawLimit !== null && Number.isNaN(rawLimit)) {
      res.status(400);
      return next(new Error('Invalid limit'));
    }
    const limit = rawLimit == null ? null : Math.min(Math.max(rawLimit, 1), 500);
    const [notes, deletedIds] = await Promise.all([
      Note.find({ userId }).sort({ createdAt: -1 }).lean().exec(),
      filterDeletedIdsSince(userId, 'NOTE', since),
    ]);
    const changedNotes = filterNotesChangedSince(notes as any[], since).map((note) => ({
      ...note,
    }));
    const limitedItems = limit == null ? changedNotes : changedNotes.slice(0, limit);
    res.json({
      items: limitedItems,
      deletedIds,
      serverTime: new Date().toISOString(),
      ...(limit == null ? {} : { hasMore: changedNotes.length > limit, limit }),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/notes/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteId = assertValidObjectId(req.params.id, 'ID');
    const cacheKey = `notes:item:${userId}:${noteId}`;
    const cachedNote = await cache.get(cacheKey);
    if (cachedNote) {
      res.json(cachedNote);
      return;
    }
    const note = await findOwnedById(Note, userId, noteId).lean().exec();
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
    // Check if locked (simplified check, not recursive for single note efficiency, but inaccurate)
    // To be consistent, we should use the same logic or just return it.
    // Let's just return it. The client handles decryption/locking view.
    // But wait, GET / hides content.
    const sanitizedNote = omitSensitiveNoteFields(note as any);
    await cache.set(cacheKey, sanitizedNote, 300);
    res.json(sanitizedNote);
  } catch (error) {
    next(error);
  }
});

// POST /api/notes/:id/verify-lock
router.post('/:id/verify-lock', verifyLockLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const targetId = assertValidObjectId(req.params.id, 'ID');
    const targetNote = await findOwnedById(Note, userId, targetId).select('+password');
    
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
      if (typeof current.password === 'string' && current.password.length > 0) {
        blockingNote = current;
        break;
      }
      if (!current.parentId) break;
      current = await findOwnedById(Note, userId, String(current.parentId)).select('+password');
    }

    const toUnlockedResponse = (unlockedId: string | null) => ({
      success: true,
      unlockedId,
      ...omitSensitiveNoteFields(targetNote.toObject()),
    });

    if (!blockingNote) {
      res.json(toUnlockedResponse(null));
      return;
    }

    const password = normalizePasswordInput(req.body?.password);
    if (password === null || password.length === 0 || !blockingNote.password) {
      await bcrypt.compare(typeof req.body?.password === 'string' ? req.body.password : '', DUMMY_PASSWORD_HASH);
      res.json({ success: false, message: 'Invalid password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, blockingNote.password);
    if (!isMatch) {
      // Return 200 OK with success: false instead of 401 to prevent frontend logout
      res.json({ success: false, message: 'Invalid password' });
      return;
    }

    res.json(toUnlockedResponse(String(blockingNote._id)));
  } catch (error) {
    next(error);
  }
});

// POST /api/notes
router.post('/', validate(noteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const io = req.app.get('io');
    const createdObj = await createNoteRecord(userId, req.body, io);
    res.status(201).json(createdObj);
  } catch (error) {
    if ((error as any)?.status) {
      res.status((error as any).status);
    }
    next(error);
  }
});

// POST /api/notes/sync
router.post('/sync', validate(bulkSyncSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const io = req.app.get('io');
    const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
    const results: any[] = [];

    for (const operation of operations) {
      const action = operation.action as 'CREATE' | 'UPDATE' | 'DELETE';
      if (action === 'CREATE') {
        const { error } = noteSchema.validate(operation.data);
        if (error) {
          res.status(400);
          return next(error);
        }
        const item = await createNoteRecord(userId, operation.data, io);
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'NOTE',
          status: 'applied',
          tempId: operation.tempId,
          itemId: item._id,
          item,
        });
        continue;
      }

      const noteId = assertValidObjectId(operation.id, 'ID');
      if (action === 'UPDATE') {
        const { error } = updateSchema.validate(operation.data);
        if (error) {
          res.status(400);
          return next(error);
        }
        const result = await updateNoteRecord(userId, noteId, operation.data, io);
        if (result.status === 'not_found') {
          results.push({
            clientOperationId: operation.clientOperationId,
            action,
            entity: 'NOTE',
            status: 'not_found',
            id: noteId,
            itemId: noteId,
          });
          continue;
        }
        if (result.status === 'conflict') {
          results.push({
            clientOperationId: operation.clientOperationId,
            action,
            status: 'conflict',
            id: noteId,
            ...result.conflict,
          });
          continue;
        }
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'NOTE',
          status: 'applied',
          id: noteId,
          itemId: result.item._id,
          item: result.item,
        });
        continue;
      }

      const result = await deleteNoteRecord(userId, noteId, io);
      if (result.status === 'not_found') {
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'NOTE',
          status: 'not_found',
          id: noteId,
          itemId: noteId,
        });
        continue;
      }
      results.push({
        clientOperationId: operation.clientOperationId,
        action,
        entity: 'NOTE',
        status: 'applied',
        id: noteId,
        itemId: noteId,
        deletedIds: result.deletedNoteIds,
        deletedTaskIds: result.deletedTaskIds,
      });
    }

    res.json({
      results,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    if ((error as any)?.status) {
      res.status((error as any).status);
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

    let reorderWarning: { attempted: number; matched: number } | null = null;
    if (updates.length > 0) {
      const result = await Note.bulkWrite(updates);
      const attempted = updates.length;
      const matched = Number(result.matchedCount || 0);
      if (matched < attempted) {
        reorderWarning = { attempted, matched };
      }
    }

    await cache.del(`notes:list:${userId}`);
    await cache.delMany(notes.map((note) => `notes:item:${userId}:${note._id}`));

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('notes:reordered', notes);

    if (reorderWarning) {
      return res.status(207).json({
        message: 'Notes reordered with partial ownership match',
        ...reorderWarning,
      });
    }
    res.json({ message: 'Notes reordered' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notes/:id
router.put('/:id', validate(updateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteId = assertValidObjectId(req.params.id, 'ID');
    const io = req.app.get('io');
    const result = await updateNoteRecord(userId, noteId, req.body, io);
    if (result.status === 'not_found') {
      res.status(404);
      return next(new Error('Note not found'));
    }
    if (result.status === 'conflict') {
      return res.status(409).json(result.conflict);
    }
    res.json(result.item);
  } catch (error) {
    if ((error as any)?.status) {
      res.status((error as any).status);
    }
    next(error);
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteId = assertValidObjectId(req.params.id, 'ID');
    const io = req.app.get('io');
    const result = await deleteNoteRecord(userId, noteId, io);
    if (result.status === 'not_found') {
      res.status(404);
      return next(new Error('Note not found'));
    }
    res.json({ message: 'Note removed' });
  } catch (error) {
    if ((error as any)?.status) {
      res.status((error as any).status);
    }
    next(error);
  }
});

export default router;
