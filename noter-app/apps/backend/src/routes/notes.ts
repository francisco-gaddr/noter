import express, { Request, Response, NextFunction } from 'express';
import Note from '../models/Note';
import Task from '../models/Task';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import cache from '../services/cache';

const router = express.Router();

// Validation schemas
const noteSchema = Joi.object({
  title: Joi.string().required(),
  content: Joi.string().allow('').required(),
  tags: Joi.array().items(Joi.string()),
  parentId: Joi.string().allow(null),
  locked: Joi.boolean(),
  password: Joi.string().allow(''),
  icon: Joi.string().allow(null, ''),
  order: Joi.number(),
  type: Joi.string().allow('note', 'task_list', 'project').allow(null, '').required(),
  clientId: Joi.string().allow('').optional()
});

const updateSchema = Joi.object({
  title: Joi.string(),
  content: Joi.string().allow(''),
  tags: Joi.array().items(Joi.string()),
  parentId: Joi.string().allow(null),
  locked: Joi.boolean(),
  password: Joi.string().allow(''),
  icon: Joi.string().allow(null, ''),
  order: Joi.number(),
  type: Joi.string().allow(null, '')
});

const reorderSchema = Joi.object({
  notes: Joi.array()
    .items(
      Joi.object({
        _id: Joi.string().required(),
        order: Joi.number().required(),
      }).unknown(true),
    )
    .required(),
});

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

    const notes = await Note.find({ userId: (req as AuthRequest).user!.userId }).sort({ order: 1, createdAt: -1 });
    
    // Early return if no notes
    if (notes.length === 0) {
      res.json([]);
      return;
    }
    
    // Since locked is now E2E encrypted, we cannot determine lock status on the server
    // The client handles lock logic and decryption. We return all notes as-is.
    const sanitizedNotes = notes.map(note => {
      const noteObj = note.toObject();
      // Note: Content hiding for locked notes is now handled client-side
      // since we cannot decrypt the locked field server-side
      return noteObj;
    });

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
    const note = await Note.findById(req.params.id);
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
    if (noteObj.locked) {
        noteObj.content = '';
    }
    
    await cache.set(cacheKey, noteObj, 300);
    res.json(noteObj);
  } catch (error) {
    next(error);
  }
});

// POST /api/notes/:id/verify-lock
router.post('/:id/verify-lock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetId = req.params.id;
    const targetNote = await Note.findById(targetId);
    
    if (!targetNote) {
      res.status(404);
      return next(new Error('Note not found'));
    }

    // With E2E encryption, lock verification is now handled client-side
    // This endpoint is deprecated but kept for compatibility
    // The client will decrypt the locked field and determine if the note is locked
    
    // For now, we'll just return the note content if a password is provided
    // The actual lock logic is handled by the client after decryption
    if (req.body.password) {
      // Check if this note has a password set
      if (targetNote.password) {
        const isMatch = await bcrypt.compare(req.body.password, targetNote.password);
        if (isMatch) {
          res.json({ success: true, content: targetNote.content });
        } else {
          res.status(401);
          next(new Error('Invalid password'));
        }
      } else {
        // No password set, but client requested unlock - this is for compatibility
        res.json({ success: true, content: targetNote.content });
      }
    } else {
      // No password provided, return content anyway (client will handle encryption)
      res.json({ success: true, content: targetNote.content });
    }
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
      noteData.password = await bcrypt.hash(noteData.password, 10);
    }

    // Handle encrypted timestamps if not provided
    if (!noteData.createdAt) {
      noteData.createdAt = new Date().toISOString();
    }
    if (!noteData.updatedAt) {
      noteData.updatedAt = new Date().toISOString();
    }

    const note = new Note(noteData);
    const createdNote = await note.save();
    
    await cache.del(`notes:list:${userId}`);

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('note:created', createdNote);

    res.status(201).json(createdNote);
  } catch (error) {
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
    const note = await Note.findById(req.params.id);

    if (note) {
      if (value.title) note.title = value.title;
      if (value.content !== undefined) note.content = value.content;
      if (value.tags) note.tags = value.tags;
      if (value.parentId !== undefined) note.parentId = value.parentId;
      if (value.locked !== undefined) note.locked = value.locked; // Now stored as encrypted string
      if (value.type !== undefined) note.type = value.type;
      if (value.password !== undefined) {
        if (value.password) {
            note.password = await bcrypt.hash(value.password, 10);
        } else {
            note.password = '';
        }
      }
      if (value.icon !== undefined) note.icon = value.icon;
      if (value.order !== undefined) note.order = value.order;
      if (value.createdAt !== undefined) note.createdAt = value.createdAt; // Handle encrypted timestamps
      if (value.updatedAt !== undefined) note.updatedAt = value.updatedAt; // Handle encrypted timestamps

      const updatedNote = await note.save();
      
      const userId = (req as AuthRequest).user!.userId;
      await cache.del(`notes:list:${userId}`);
      await cache.del(`notes:item:${userId}:${req.params.id}`);

      const noteObj = updatedNote.toObject();
      if (noteObj.locked) {
        noteObj.content = '';
      }
      
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
      let deletedTaskIds: string[] = [];
      if (note.type === 'task_list') {
        const tasks = await Task.find({ userId, parentNoteId: note._id }).select('_id');
        deletedTaskIds = tasks.map(t => t._id.toString());
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
