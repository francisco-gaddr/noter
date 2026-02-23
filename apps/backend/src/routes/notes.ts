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
  locked: Joi.alternatives().try(Joi.boolean(), Joi.string().allow('')),
  password: Joi.string().allow(''),
  icon: Joi.string().allow(null, ''),
  order: Joi.number(),
  type: Joi.string().allow('note', 'task_list', 'project').allow(null, '').required(),
  clientId: Joi.string().allow('').optional(),
  createdAt: Joi.string().allow(''),
  updatedAt: Joi.string().allow('')
});

const updateSchema = Joi.object({
  title: Joi.string(),
  content: Joi.string().allow(''),
  tags: Joi.array().items(Joi.string()),
  parentId: Joi.string().allow(null),
  locked: Joi.alternatives().try(Joi.boolean(), Joi.string().allow('')),
  password: Joi.string().allow(''),
  icon: Joi.string().allow(null, ''),
  order: Joi.number(),
  type: Joi.string().allow(null, ''),
  createdAt: Joi.string().allow(''),
  updatedAt: Joi.string().allow('')
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

    const notes = await Note.find({ userId: (req as AuthRequest).user!.userId }).select('+password').sort({ order: 1, createdAt: -1 });
    
    // Create a map for quick lookup
    const notesMap = new Map(notes.map(n => [n._id.toString(), n]));
    const memo = new Map<string, boolean>();

    // Helper to check if a note is effectively locked
    const isLocked = (startId: string): boolean => {
        if (memo.has(startId)) return memo.get(startId)!;

        let currentId: string | undefined = startId;
        const path = new Set<string>();

        while (currentId) {
            // Check cycle in current path
            if (path.has(currentId)) {
                // Cycle detected. Treat as unlocked to break loop.
                for (const id of path) memo.set(id, false);
                return false;
            }

            // Check memo
            if (memo.has(currentId)) {
                const result = memo.get(currentId)!;
                // Propagate result to all visited nodes
                for (const id of path) memo.set(id, result);
                return result;
            }

            const note = notesMap.get(currentId);
            
            // If note doesn't exist (orphan ID), treat as unlocked end of chain
            if (!note) {
                 for (const id of path) memo.set(id, false);
                 return false;
            }

            path.add(currentId);

            // Check lock status of current note
            if ((note as any).locked === true || Boolean((note as any).password)) {
                // Found a lock!
                for (const id of path) memo.set(id, true);
                return true;
            }

            // Move to parent
            if (!note.parentId) {
                // Root reached, no lock found
                for (const id of path) memo.set(id, false);
                return false;
            }
            
            currentId = note.parentId.toString();
            
            // Self-reference check (trivial cycle)
            if (currentId === note._id.toString()) {
                 for (const id of path) memo.set(id, false);
                 return false;
            }
        }
        
        return false;
    };

    // Hide content for locked notes (and their descendants)
    const sanitizedNotes = notes.map(note => {
      const noteObj: any = note.toObject();
      if (isLocked(note._id.toString())) {
        noteObj.content = ''; // Clear content for locked notes
      }
      if (noteObj.lockedEnc) {
        noteObj.locked = noteObj.lockedEnc;
      }
      if (noteObj.createdAtEnc) {
        noteObj.createdAt = noteObj.createdAtEnc;
      }
      if (noteObj.updatedAtEnc) {
        noteObj.updatedAt = noteObj.updatedAtEnc;
      }
      delete noteObj.lockedEnc;
      delete noteObj.createdAtEnc;
      delete noteObj.updatedAtEnc;
      delete noteObj.password;
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
    const note = await Note.findById(req.params.id).select('+password');
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
    const noteObj: any = note.toObject();
    
    // Check if locked (simplified check, not recursive for single note efficiency, but inaccurate)
    // To be consistent, we should use the same logic or just return it.
    // Let's just return it. The client handles decryption/locking view.
    // But wait, GET / hides content.
    if ((noteObj as any).locked === true || Boolean((noteObj as any).password)) {
        noteObj.content = '';
    }
    if ((noteObj as any).lockedEnc) {
      noteObj.locked = (noteObj as any).lockedEnc;
    }
    if ((noteObj as any).createdAtEnc) {
      noteObj.createdAt = (noteObj as any).createdAtEnc;
    }
    if ((noteObj as any).updatedAtEnc) {
      noteObj.updatedAt = (noteObj as any).updatedAtEnc;
    }
    delete (noteObj as any).lockedEnc;
    delete (noteObj as any).createdAtEnc;
    delete (noteObj as any).updatedAtEnc;
    delete (noteObj as any).password;
    
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

    // Find the nearest locked ancestor (or self)
    let currentId: string | undefined = targetId;
    let lockerNode: any = null;

    // We need to traverse up. Since we don't have full tree here efficiently,
    // we can either fetch all (consistent with GET) or iterative find.
    // Iterative find is okay for a single request.
    while (currentId) {
        const note = await Note.findById(currentId).select('+password');
        if (!note) break;
        if ((note as any).locked === true || Boolean((note as any).password)) {
            lockerNode = note;
            break;
        }
        currentId = note.parentId?.toString();
    }

    if (!lockerNode) {
      // No lock found in chain
      res.json({ success: true, content: targetNote.content });
      return;
    }

    // Verify password against the locker node
    const isMatch = await bcrypt.compare(req.body.password, lockerNode.password);
    if (isMatch) {
      res.json({ success: true, content: targetNote.content });
    } else {
      res.status(401);
      next(new Error('Invalid password'));
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
    if (typeof noteData.locked === 'string') {
      noteData.lockedEnc = noteData.locked;
      delete noteData.locked;
    }
    if (typeof noteData.createdAt === 'string' && noteData.createdAt.length > 0) {
      noteData.createdAtEnc = noteData.createdAt;
      delete noteData.createdAt;
    }
    if (typeof noteData.updatedAt === 'string' && noteData.updatedAt.length > 0) {
      noteData.updatedAtEnc = noteData.updatedAt;
      delete noteData.updatedAt;
    }

    const note = new Note(noteData);
    const createdNote = await note.save();
    
    await cache.del(`notes:list:${userId}`);

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('note:created', createdNote);

    const createdObj: any = createdNote.toObject();
    if ((createdObj as any).lockedEnc) {
      (createdObj as any).locked = (createdObj as any).lockedEnc;
    }
    if ((createdObj as any).createdAtEnc) {
      (createdObj as any).createdAt = (createdObj as any).createdAtEnc;
    }
    if ((createdObj as any).updatedAtEnc) {
      (createdObj as any).updatedAt = (createdObj as any).updatedAtEnc;
    }
    delete (createdObj as any).lockedEnc;
    delete (createdObj as any).createdAtEnc;
    delete (createdObj as any).updatedAtEnc;
    delete (createdObj as any).password;
    res.status(201).json(createdObj);
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
      if (value.locked !== undefined) {
        if (typeof value.locked === 'string') {
          (note as any).lockedEnc = value.locked;
        } else {
          note.locked = value.locked;
        }
      }
      if (value.type !== undefined) note.type = value.type;
      if (value.password !== undefined) {
        if (value.password) {
            note.password = await bcrypt.hash(value.password, 10);
        } else {
            note.password = '';
        }
      }
      if (typeof value.createdAt === 'string' && value.createdAt.length > 0) {
        (note as any).createdAtEnc = value.createdAt;
      }
      if (typeof value.updatedAt === 'string' && value.updatedAt.length > 0) {
        (note as any).updatedAtEnc = value.updatedAt;
      }
      if (value.icon !== undefined) note.icon = value.icon;
      if (value.order !== undefined) note.order = value.order;

      const updatedNote = await note.save();
      
      const userId = (req as AuthRequest).user!.userId;
      await cache.del(`notes:list:${userId}`);
      await cache.del(`notes:item:${userId}:${req.params.id}`);

      const noteObj: any = updatedNote.toObject();
      if ((noteObj as any).locked === true || Boolean((noteObj as any).password)) {
        noteObj.content = '';
      }
      if ((noteObj as any).lockedEnc) {
        noteObj.locked = (noteObj as any).lockedEnc;
      }
      if ((noteObj as any).createdAtEnc) {
        noteObj.createdAt = (noteObj as any).createdAtEnc;
      }
      if ((noteObj as any).updatedAtEnc) {
        noteObj.updatedAt = (noteObj as any).updatedAtEnc;
      }
      delete (noteObj as any).lockedEnc;
      delete (noteObj as any).createdAtEnc;
      delete (noteObj as any).updatedAtEnc;
      delete (noteObj as any).password;
      
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
