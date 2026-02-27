import { z } from 'zod';
import { Tool } from './index';

export interface EntityDB {
  createNote: (note: { title: string; content: string }) => Promise<any>;
  updateNote: (id: string, updates: any) => Promise<any>;
  getNote: (id: string) => Promise<any>;
  deleteNote: (id: string) => Promise<void>;
  createTask: (task: { title: string; parentNoteId?: string }) => Promise<any>;
  completeTask: (id: string) => Promise<void>;
}

export const createStandardTools = (db: EntityDB): Tool[] => [
  {
    name: 'create_note',
    description: 'Create a new note with title and content',
    parameters: z.object({
      title: z.string(),
      content: z.string()
    }),
    execute: async (args) => db.createNote(args)
  },
  {
    name: 'update_note',
    description: 'Update an existing note',
    parameters: z.object({
      id: z.string(),
      updates: z.object({
        title: z.string().optional(),
        content: z.string().optional()
      })
    }),
    execute: async (args) => db.updateNote(args.id, args.updates)
  },
  {
    name: 'get_note',
    description: 'Get a note by ID',
    parameters: z.object({
      id: z.string()
    }),
    execute: async (args) => db.getNote(args.id)
  },
  {
    name: 'create_task',
    description: 'Create a new task',
    parameters: z.object({
      title: z.string(),
      parentNoteId: z.string().optional()
    }),
    execute: async (args) => db.createTask(args)
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed',
    parameters: z.object({
      id: z.string()
    }),
    execute: async (args) => db.completeTask(args.id)
  }
];
