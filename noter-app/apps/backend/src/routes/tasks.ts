import express, { Request, Response, NextFunction } from 'express';
import Task from '../models/Task';
import Note from '../models/Note';
import DeletionTombstone from '../models/DeletionTombstone';
import Joi from 'joi';
import { AuthRequest } from '../middleware/authMiddleware';
import mongoose from 'mongoose';
import { validate } from '../middleware/validate';
import { decrypt } from '@repo/shared';
import { isEncryptedPayload } from '../utils/encryption';
import cache from '../services/cache';
import { assertValidObjectId, findOwnedById } from '../utils/ownedQuery';

const router = express.Router();

const encryptedRequired = Joi.string().custom((value, helpers) => (
  isEncryptedPayload(value) ? value : helpers.error('any.invalid')
));
const encryptedOptional = Joi.alternatives().try(Joi.string().valid(''), encryptedRequired);

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

const filterTasksChangedSince = <T extends { updatedAt?: unknown }>(items: T[], since: string | null) => {
  if (!since) return items;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return items;
  return items.filter((item) => {
    const updatedAt = resolveStoredUpdatedAt(item.updatedAt);
    if (!updatedAt) return true;
    return Date.parse(updatedAt) > sinceMs;
  });
};

const filterDeletedTaskIdsSince = async (
  userId: string,
  since: string | null,
  parentNoteId?: string,
) => {
  const query: Record<string, unknown> = { userId, entity: 'TASK' };
  if (since) {
    query.deletedAt = { $gt: new Date(since) };
  }
  if (parentNoteId) {
    query.parentNoteId = parentNoteId;
  }
  const tombstones = await DeletionTombstone.find(query)
    .sort({ deletedAt: -1 })
    .select('itemId')
    .lean()
    .exec();
  return Array.from(new Set(tombstones.map((item: any) => String(item.itemId)).filter(Boolean)));
};

const taskSchema = Joi.object({
  clientId: Joi.string().allow('').optional(),
  title: encryptedRequired.required(),
  description: encryptedOptional.optional(),
  dueDate: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  completed: encryptedOptional.optional(),
  priority: encryptedOptional.optional(),
  parentNoteId: Joi.string().allow(null),
  createdAt: encryptedRequired.required(),
  updatedAt: encryptedRequired.required(),
  position: encryptedOptional.optional(),
  recurrenceType: encryptedOptional.optional(),
  recurrenceDays: encryptedOptional.optional(),
  reminderEnabled: encryptedOptional.optional(),
  reminderOffsetMinutes: encryptedOptional.optional()
});

const assignSchema = Joi.object({
  noteId: Joi.string().required()
});

const reorderSchema = Joi.object({
  tasks: Joi.array().items(
    Joi.object({
      _id: Joi.string().required(),
      position: encryptedRequired.required()
    }).unknown(true)
  ).max(1000).required()
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

const updateTaskSchema = Joi.object({
  clientMutationId: Joi.string().max(128).optional(),
  baseUpdatedAt: Joi.string().isoDate().optional(),
  title: encryptedRequired.optional(),
  description: encryptedOptional.optional(),
  dueDate: Joi.alternatives().try(Joi.valid(null), encryptedOptional).optional(),
  completed: encryptedOptional.optional(),
  priority: encryptedOptional.optional(),
  parentNoteId: Joi.string().allow(null),
  position: encryptedOptional.optional(),
  updatedAt: encryptedOptional.optional(),
  recurrenceType: encryptedOptional.optional(),
  recurrenceDays: encryptedOptional.optional(),
  reminderEnabled: encryptedOptional.optional(),
  reminderOffsetMinutes: encryptedOptional.optional()
});

const getTaskListCacheKey = (userId: string, parentNoteId?: string | null) => (
  parentNoteId ? `tasks:list:${userId}:note:${parentNoteId}` : `tasks:list:${userId}:all`
);

const getTaskCacheKeys = (userId: string, parentNoteIds: Array<string | null | undefined>) => (
  Array.from(new Set([
    getTaskListCacheKey(userId),
    ...parentNoteIds.map((parentNoteId) => getTaskListCacheKey(userId, parentNoteId ?? undefined)),
  ]))
);

const createTaskRecord = async (userId: string, taskData: any, io: any) => {
  if (taskData.clientId) {
    const existingTask = await Task.findOne({ userId, clientId: taskData.clientId });
    if (existingTask) {
      return existingTask.toObject();
    }
  }

  const task = new Task({ ...taskData, userId });
  const createdTask = await task.save();
  const createdObj = createdTask.toObject();
  await cache.delMany(getTaskCacheKeys(userId, [null, createdTask.parentNoteId?.toString()]));
  io.to(`user:${userId}`).emit('task:created', createdObj);
  return createdObj;
};

const updateTaskRecord = async (userId: string, taskId: string, value: any, io: any) => {
  const task = await findOwnedById(Task, userId, taskId);
  if (!task) {
    return { status: 'not_found' as const };
  }

  const baseUpdatedAt = parseIsoDate(value.baseUpdatedAt);
  const currentUpdatedAt = resolveStoredUpdatedAt(task.updatedAt);
  if (baseUpdatedAt && currentUpdatedAt && baseUpdatedAt !== currentUpdatedAt) {
    const taskObject = task.toObject();
    return {
      status: 'conflict' as const,
      conflict: {
        message: 'Task has changed on another device',
        code: 'SYNC_CONFLICT',
        entity: 'TASK',
        itemId: task._id.toString(),
        localBaseUpdatedAt: baseUpdatedAt,
        serverUpdatedAt: currentUpdatedAt,
        conflictFields: ['updatedAt'],
        item: taskObject,
        serverItem: taskObject,
      },
    };
  }

  const previousParentNoteId = task.parentNoteId?.toString() ?? null;
  if (value.title !== undefined) task.title = value.title;
  if (value.description !== undefined) task.description = value.description;
  if (value.dueDate !== undefined) task.dueDate = value.dueDate;
  if (value.completed !== undefined) task.completed = value.completed;
  if (value.priority !== undefined) task.priority = value.priority;
  if (value.parentNoteId !== undefined) task.parentNoteId = value.parentNoteId;
  if (value.position !== undefined) task.position = value.position;
  if (value.updatedAt !== undefined) task.updatedAt = value.updatedAt;
  if (value.recurrenceType !== undefined) task.recurrenceType = value.recurrenceType;
  if (value.recurrenceDays !== undefined) task.recurrenceDays = value.recurrenceDays;
  if (value.reminderEnabled !== undefined) task.reminderEnabled = value.reminderEnabled;
  if (value.reminderOffsetMinutes !== undefined) task.reminderOffsetMinutes = value.reminderOffsetMinutes;

  const updatedTask = await task.save();
  const updatedObj = updatedTask.toObject();
  await cache.delMany(getTaskCacheKeys(userId, [previousParentNoteId, updatedTask.parentNoteId?.toString()]));
  io.to(`user:${userId}`).emit('task:updated', updatedObj);
  return { status: 'applied' as const, item: updatedObj };
};

const deleteTaskRecord = async (userId: string, taskId: string, io: any) => {
  const task = await findOwnedById(Task, userId, taskId);
  if (!task) {
    return { status: 'not_found' as const };
  }
  const parentNoteId = task.parentNoteId?.toString() ?? null;
  const deletionTimestamp = new Date();
  await Promise.all([
    task.deleteOne(),
    cache.delMany(getTaskCacheKeys(userId, [parentNoteId])),
    DeletionTombstone.updateOne(
      { userId, entity: 'TASK', itemId: taskId },
      {
        $set: {
          userId,
          entity: 'TASK',
          itemId: taskId,
          parentNoteId,
          deletedAt: deletionTimestamp,
        },
      },
      { upsert: true },
    ),
  ]);
  io.to(`user:${userId}`).emit('task:deleted', taskId);
  return { status: 'applied' as const, deletedIds: [taskId] };
};

// GET /api/tasks
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const rawParentNoteId = req.query.parentNoteId;
    if (rawParentNoteId !== undefined && typeof rawParentNoteId !== 'string') {
      res.status(400);
      return next(new Error('Invalid parentNoteId'));
    }
    const parentNoteId = typeof rawParentNoteId === 'string' ? rawParentNoteId : undefined;
    if (parentNoteId && !mongoose.Types.ObjectId.isValid(parentNoteId)) {
      res.status(400);
      return next(new Error('Invalid parentNoteId'));
    }
    const cacheKey = getTaskListCacheKey(userId, parentNoteId);
    const cachedTasks = await cache.get(cacheKey);
    if (cachedTasks) {
      res.json(cachedTasks);
      return;
    }
    const filter: any = { userId };
    if (parentNoteId) {
      filter.parentNoteId = parentNoteId;
    }
    const tasks = await Task.find(filter).sort({ createdAt: -1 }).lean().exec();
    await cache.set(cacheKey, tasks, 300);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/changes?since=ISO_DATE&parentNoteId=...
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
    const rawParentNoteId = req.query.parentNoteId;
    if (rawParentNoteId !== undefined && typeof rawParentNoteId !== 'string') {
      res.status(400);
      return next(new Error('Invalid parentNoteId'));
    }
    const parentNoteId = typeof rawParentNoteId === 'string' ? rawParentNoteId : undefined;
    if (parentNoteId && !mongoose.Types.ObjectId.isValid(parentNoteId)) {
      res.status(400);
      return next(new Error('Invalid parentNoteId'));
    }
    const filter: any = { userId };
    if (parentNoteId) filter.parentNoteId = parentNoteId;
    const [tasks, deletedIds] = await Promise.all([
      Task.find(filter).sort({ createdAt: -1 }).lean().exec(),
      filterDeletedTaskIdsSince(userId, since, parentNoteId),
    ]);
    const changedTasks = filterTasksChangedSince(tasks as any[], since);
    const limitedItems = limit == null ? changedTasks : changedTasks.slice(0, limit);
    res.json({
      items: limitedItems,
      deletedIds,
      serverTime: new Date().toISOString(),
      ...(limit == null ? {} : { hasMore: changedTasks.length > limit, limit }),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks
router.post('/', validate(taskSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const io = req.app.get('io');
    const createdTask = await createTaskRecord(userId, req.body, io);
    res.status(201).json(createdTask);
  } catch (error: any) {
    // Handle duplicate key error gracefully
    if (error.code === 11000 && error.keyPattern?.clientId) {
      const existingTask = await Task.findOne({ 
        userId: (req as AuthRequest).user!.userId, 
        clientId: req.body.clientId 
      });
      if (existingTask) {
        res.json(existingTask);
        return;
      }
    }
    next(error);
  }
});

router.post('/sync', validate(bulkSyncSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const io = req.app.get('io');
    const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
    const results: any[] = [];

    for (const operation of operations) {
      const action = operation.action as 'CREATE' | 'UPDATE' | 'DELETE';
      if (action === 'CREATE') {
        const { error } = taskSchema.validate(operation.data);
        if (error) {
          res.status(400);
          return next(error);
        }
        const item = await createTaskRecord(userId, operation.data, io);
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'TASK',
          status: 'applied',
          tempId: operation.tempId,
          itemId: item._id,
          item,
        });
        continue;
      }

      const taskId = assertValidObjectId(operation.id, 'ID');
      if (action === 'UPDATE') {
        const { error } = updateTaskSchema.validate(operation.data);
        if (error) {
          res.status(400);
          return next(error);
        }
        const result = await updateTaskRecord(userId, taskId, operation.data, io);
        if (result.status === 'not_found') {
          results.push({
            clientOperationId: operation.clientOperationId,
            action,
            entity: 'TASK',
            status: 'not_found',
            id: taskId,
            itemId: taskId,
          });
          continue;
        }
        if (result.status === 'conflict') {
          results.push({
            clientOperationId: operation.clientOperationId,
            action,
            status: 'conflict',
            id: taskId,
            ...result.conflict,
          });
          continue;
        }
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'TASK',
          status: 'applied',
          id: taskId,
          itemId: result.item._id,
          item: result.item,
        });
        continue;
      }

      const result = await deleteTaskRecord(userId, taskId, io);
      if (result.status === 'not_found') {
        results.push({
          clientOperationId: operation.clientOperationId,
          action,
          entity: 'TASK',
          status: 'not_found',
          id: taskId,
          itemId: taskId,
        });
        continue;
      }
      results.push({
        clientOperationId: operation.clientOperationId,
        action,
        entity: 'TASK',
        status: 'applied',
        id: taskId,
        itemId: taskId,
        deletedIds: result.deletedIds,
      });
    }

    res.json({
      results,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/assign-to-list
router.put('/assign-to-list', validate(assignSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteId = req.body.noteId;
    
    const ownedNoteId = assertValidObjectId(noteId, 'noteId');
    const listNote = await findOwnedById(Note, userId, ownedNoteId);
    if (!listNote) {
      res.status(404);
      return next(new Error('List note not found'));
    }
    const result = await Task.updateMany(
      { userId, parentNoteId: null },
      { $set: { parentNoteId: ownedNoteId } }
    );
    await cache.delMany(getTaskCacheKeys(userId, [null, ownedNoteId]));
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/reorder
router.put('/reorder', validate(reorderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tasks } = req.body; // Array of { _id, position }
    const userId = (req as AuthRequest).user!.userId;

    const validTasks = (tasks as Array<{ _id: string; position: string }>).filter((t) =>
      mongoose.Types.ObjectId.isValid(t._id),
    );
    const affectedTasks = validTasks.length > 0
      ? await Task.find({
          userId,
          _id: {
            $in: validTasks.map((task) => new mongoose.Types.ObjectId(task._id)),
          },
        }).select('parentNoteId').lean().exec()
      : [];

    const updates = validTasks.map((t) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(t._id), userId },
        update: { $set: { position: t.position } }
      }
    }));

    let reorderWarning: { attempted: number; matched: number } | null = null;
    if (updates.length > 0) {
        const result = await Task.bulkWrite(updates);
        const attempted = updates.length;
        const matched = Number(result.matchedCount || 0);
        if (matched < attempted) {
          reorderWarning = { attempted, matched };
        }
    }
    await cache.delMany(getTaskCacheKeys(userId, affectedTasks.map((task: any) => task.parentNoteId?.toString())));
    
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('tasks:reordered', validTasks);

    if (reorderWarning) {
      return res.status(207).json({
        message: 'Tasks reordered with partial ownership match',
        ...reorderWarning,
      });
    }
    res.json({ message: 'Tasks reordered' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id
router.put('/:id', validate(updateTaskSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const taskId = assertValidObjectId(req.params.id, 'ID');
    const io = req.app.get('io');
    const result = await updateTaskRecord(userId, taskId, req.body, io);
    if (result.status === 'not_found') {
        res.status(404);
        return next(new Error('Task not found'));
    }
    if (result.status === 'conflict') {
      return res.status(409).json(result.conflict);
    }
    res.json(result.item);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const taskId = assertValidObjectId(req.params.id, 'ID');
    const io = req.app.get('io');
    const result = await deleteTaskRecord(userId, taskId, io);
    if (result.status === 'not_found') {
      res.status(404);
      return next(new Error('Task not found'));
    }
    res.json({ message: 'Task removed' });
  } catch (error) {
    next(error);
  }
});

export default router;
