import express, { Request, Response, NextFunction } from 'express';
import Task from '../models/Task';
import Note from '../models/Note';
import Joi from 'joi';
import { AuthRequest } from '../middleware/authMiddleware';
import mongoose from 'mongoose';
import { validate } from '../middleware/validate';
import { isEncryptedPayload } from '../utils/encryption';
import { parsePageParams, buildCursorFilter, buildPage } from '../utils/pagination';
import { runWithReadPreference } from '../utils/readPreference';

const router = express.Router();

const encryptedRequired = Joi.string().custom((value, helpers) => (
  isEncryptedPayload(value) ? value : helpers.error('any.invalid')
));
const encryptedOptional = Joi.alternatives().try(Joi.string().valid(''), encryptedRequired);

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
  ).required()
});

const updateTaskSchema = Joi.object({
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

// GET /api/tasks
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: any = { userId: (req as AuthRequest).user!.userId };
    if (req.query.parentNoteId) {
        filter.parentNoteId = req.query.parentNoteId;
    }
    // Cursor pagination is opt-in via ?limit/?cursor; without them we keep
    // the historical full-list shape so existing clients aren't broken.
    const wantsPagination = typeof req.query.limit !== 'undefined' || typeof req.query.cursor !== 'undefined';
    if (wantsPagination) {
      const { limit, cursor } = parsePageParams(req.query as Record<string, unknown>);
      const merged = { ...filter, ...buildCursorFilter(cursor, 'desc') };
      // Tasks list read-path can tolerate eventual consistency the same
      // way notes can — route to secondary when available.
      const query = Task.find(merged).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
      runWithReadPreference(query, 'secondaryPreferred');
      const rows = await query;
      const page = buildPage(rows.map((t) => t.toObject()) as Array<{ _id: { toString(): string }; createdAt: string }>, limit);
      res.json(page);
      return;
    }
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks
router.post('/', validate(taskSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    
    // Check for existing task with same clientId to prevent duplicates
    if (req.body.clientId) {
      const existingTask = await Task.findOne({ userId, clientId: req.body.clientId });
      if (existingTask) {
        res.json(existingTask);
        return;
      }
    }

    const taskData = { ...req.body, userId };
    
    const task = new Task(taskData);
    const createdTask = await task.save();
    
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('task:created', createdTask);

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

// PUT /api/tasks/assign-to-list
router.put('/assign-to-list', validate(assignSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const noteId = req.body.noteId;
    
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400);
      return next(new Error('Invalid noteId'));
    }
    const listNote = await Note.findOne({ _id: noteId, userId });
    if (!listNote) {
      res.status(404);
      return next(new Error('List note not found'));
    }
    const result = await Task.updateMany(
      { userId, parentNoteId: null },
      { $set: { parentNoteId: noteId } }
    );
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

    const updates = validTasks.map((t) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(t._id), userId },
        update: { $set: { position: t.position } }
      }
    }));

    if (updates.length > 0) {
        await Task.bulkWrite(updates);
    }
    
    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('tasks:reordered', validTasks);

    res.json({ message: 'Tasks reordered' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id
router.put('/:id', validate(updateTaskSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      return next(new Error('Invalid ID format'));
    }
    const task = await Task.findById(req.params.id);
    if (task) {
        // Only update fields that are present in the body (and validated)
        if (req.body.title !== undefined) task.title = req.body.title;
        if (req.body.description !== undefined) task.description = req.body.description;
        if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate;
        if (req.body.completed !== undefined) task.completed = req.body.completed;
        if (req.body.priority !== undefined) task.priority = req.body.priority;
        if (req.body.parentNoteId !== undefined) task.parentNoteId = req.body.parentNoteId;
        if (req.body.position !== undefined) task.position = req.body.position;
        if (req.body.updatedAt !== undefined) task.updatedAt = req.body.updatedAt;
        if (req.body.recurrenceType !== undefined) task.recurrenceType = req.body.recurrenceType;
        if (req.body.recurrenceDays !== undefined) task.recurrenceDays = req.body.recurrenceDays;
        if (req.body.reminderEnabled !== undefined) task.reminderEnabled = req.body.reminderEnabled;
        if (req.body.reminderOffsetMinutes !== undefined) task.reminderOffsetMinutes = req.body.reminderOffsetMinutes;
        
        const updatedTask = await task.save();
        
        const io = req.app.get('io');
        io.to(`user:${task.userId}`).emit('task:updated', updatedTask);
        
        res.json(updatedTask);
    } else {
        res.status(404);
        next(new Error('Task not found'));
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      return next(new Error('Invalid ID format'));
    }
    const task = await Task.findById(req.params.id);
    if (task) {
      await task.deleteOne();
      
      const io = req.app.get('io');
      io.to(`user:${task.userId}`).emit('task:deleted', req.params.id);
      
      res.json({ message: 'Task removed' });
    } else {
      res.status(404);
      next(new Error('Task not found'));
    }
  } catch (error) {
    next(error);
  }
});

export default router;
