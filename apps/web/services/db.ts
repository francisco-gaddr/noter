import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Note, Task, encrypt, decrypt } from '@repo/shared';

interface NoterDB extends DBSchema {
  notes: {
    key: string;
    value: Note & { pendingSync?: boolean; deleted?: boolean };
    indexes: { 'by-updated': string };
  };
  tasks: {
    key: string;
    value: Task & { pendingSync?: boolean; deleted?: boolean };
    indexes: { 'by-updated': string; 'by-note': string };
  };
}

const DB_NAME = 'noter-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<NoterDB>>;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<NoterDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
            const store = db.createObjectStore('notes', { keyPath: '_id' });
            store.createIndex('by-updated', 'updatedAt');
        }
        if (oldVersion < 2) {
            const taskStore = db.createObjectStore('tasks', { keyPath: '_id' });
            taskStore.createIndex('by-updated', 'updatedAt');
            taskStore.createIndex('by-note', 'parentNoteId');
        }
      },
    });
  }
  return dbPromise;
};

const parseTaskCompleted = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    try {
      return decrypt(value) === 'true';
    } catch {
      return Boolean(value);
    }
  }
  return false;
};

const parseTaskPriority = (value: unknown): 'low' | 'medium' | 'high' => {
  const normalize = (v: unknown): 'low' | 'medium' | 'high' => {
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    return 'medium';
  };

  if (typeof value === 'string') {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    try {
      return normalize(decrypt(value));
    } catch {
      return 'medium';
    }
  }
  return 'medium';
};

export const db = {
  // Notes
  async getAllNotes(): Promise<Note[]> {
    const db = await initDB();
    const notes = await db.getAll('notes');
    return notes.map(n => ({
        ...n,
        title: decrypt(n.title),
        content: decrypt(n.content),
        tags: n.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: n.icon ? (() => { try { return decrypt(n.icon) } catch { return n.icon } })() : undefined,
        type: n.type ? (() => { try { return decrypt(n.type) as any } catch { return n.type } })() : 'note',
    }));
  },

  async getNote(id: string): Promise<Note | undefined> {
    const db = await initDB();
    const note = await db.get('notes', id);
    if (!note) return undefined;
    return {
        ...note,
        title: decrypt(note.title),
        content: decrypt(note.content),
        tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
        type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
    };
  },

  async saveNote(note: Note, pendingSync = false): Promise<void> {
    const db = await initDB();
    const encrypted = {
        ...note,
        title: encrypt(note.title),
        content: encrypt(note.content),
        tags: note.tags?.map(t => encrypt(t)) ?? [],
        icon: note.icon ? encrypt(note.icon) : undefined,
        type: note.type ? encrypt(note.type) : undefined,
        pendingSync
    };
    await db.put('notes', encrypted);
  },

  async deleteNote(id: string): Promise<void> {
    const db = await initDB();
    await db.delete('notes', id);
  },
  
  async markAsDeleted(id: string): Promise<void> {
      const db = await initDB();
      const note = await db.get('notes', id);
      if (note) {
          await db.put('notes', { ...note, deleted: true, pendingSync: true });
      }
  },

  async getPendingSyncNotes(): Promise<(Note & { deleted?: boolean })[]> {
    const db = await initDB();
    const all = await db.getAll('notes');
    const pending = all.filter((n) => n.pendingSync);
    return pending.map(n => ({
        ...n,
        title: decrypt(n.title),
        content: decrypt(n.content),
        tags: n.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: n.icon ? (() => { try { return decrypt(n.icon) } catch { return n.icon } })() : undefined,
        type: n.type ? (() => { try { return decrypt(n.type) as any } catch { return n.type } })() : 'note',
    }));
  },

  // Tasks
  async getAllTasks(): Promise<Task[]> {
    const db = await initDB();
    const tasks = await db.getAll('tasks');
    return tasks.map(t => ({
      ...t,
      title: decrypt(t.title),
      description: t.description ? decrypt(t.description) : '',
      completed: parseTaskCompleted((t as any).completed),
      priority: parseTaskPriority((t as any).priority),
      dueDate: t.dueDate || null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
  },

  async saveTask(task: Task, pendingSync = false): Promise<void> {
    const db = await initDB();
    const encrypted = {
        ...task,
        title: encrypt(task.title),
        description: encrypt(task.description || ''),
        completed: encrypt(String(task.completed)),
        priority: encrypt(task.priority),
        pendingSync
    };
    await db.put('tasks', encrypted as any);
  },

  async deleteTask(id: string): Promise<void> {
    const db = await initDB();
    await db.delete('tasks', id);
  },

  async markTaskAsDeleted(id: string): Promise<void> {
      const db = await initDB();
      const task = await db.get('tasks', id);
      if (task) {
          await db.put('tasks', { ...task, deleted: true, pendingSync: true });
      }
  },

  async getPendingSyncTasks(): Promise<(Task & { deleted?: boolean })[]> {
    const db = await initDB();
    const all = await db.getAll('tasks');
    const pending = all.filter((t) => t.pendingSync);
    return pending.map(t => ({
      ...t,
      title: decrypt(t.title),
      description: t.description ? decrypt(t.description) : '',
      completed: parseTaskCompleted((t as any).completed),
      priority: parseTaskPriority((t as any).priority),
      dueDate: t.dueDate ? (() => { try { return new Date(decrypt(t.dueDate)).toISOString() } catch { return t.dueDate } })() : null,
    }));
  }
};
