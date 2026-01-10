import express, { Request, Response, NextFunction } from 'express';
import Task from '../models/Task';
import Note from '../models/Note';
import Joi from 'joi';
import { AuthRequest } from '../middleware/authMiddleware';
import mongoose from 'mongoose';
import { validate } from '../middleware/validate';

const router = express.Router();

const taskSchema = Joi.object({
  clientId: Joi.string().allow('').optional(),
  title: Joi.string().required(),
  description: Joi.string().allow(''),
  dueDate: Joi.string().allow(null, ''), // Encrypted date string
  completed: Joi.string().allow(''), // Encrypted boolean string
  priority: Joi.string().allow(''), // Encrypted priority string
  parentNoteId: Joi.string().allow(null)
});

const assignSchema = Joi.object({
  noteId: Joi.string().required()
});

const reorderSchema = Joi.object({
  tasks: Joi.array().items(
    Joi.object({
      _id: Joi.string().required(),
      position: Joi.number().required()
    }).unknown(true)
  ).required()
});

const updateTaskSchema = Joi.object({
  title: Joi.string(),
  description: Joi.string().allow(''),
  dueDate: Joi.string().allow(null, ''),
  completed: Joi.string().allow(''),
  priority: Joi.string().allow(''),
  parentNoteId: Joi.string().allow(null)
});

// GET /api/tasks
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: any = { userId: (req as AuthRequest).user!.userId };
    if (req.query.parentNoteId) {
        filter.parentNoteId = req.query.parentNoteId;
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

    const task = new Task({ ...req.body, userId });
    const createdTask = await task.save();
    
    const io = req.app.get('io');
    io.emit('task:created', createdTask);

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

    const updates = tasks.map((t: any) => ({
      updateOne: {
        filter: { _id: t._id, userId: (req as AuthRequest).user!.userId },
        update: { position: t.position }
      }
    }));

    if (updates.length > 0) {
        await Task.bulkWrite(updates);
    }
    
    const io = req.app.get('io');
    io.emit('tasks:reordered', tasks);

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
        
        const updatedTask = await task.save();
        
        const io = req.app.get('io');
        io.emit('task:updated', updatedTask);
        
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
      io.emit('task:deleted', req.params.id);
      
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
