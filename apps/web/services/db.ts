import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Note, Task, encrypt, decrypt } from '@repo/shared';

interface NoterDB extends DBSchema {
  notes: {
    key: string;
    value: Note & { pendingSync?: boolean | string; deleted?: boolean | string };
    indexes: { 'by-updated': string };
  };
  tasks: {
    key: string;
    value: Task & { pendingSync?: boolean | string; deleted?: boolean | string };
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

const decryptText = (value: unknown, fallback: string | null = null): string | null => {
  if (value == null) return fallback;
  const raw = typeof value === 'string' ? value : String(value);
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
};

const parseEncryptedBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    try {
      const decrypted = decrypt(value);
      if (decrypted === 'true' || decrypted === '1') return true;
      if (decrypted === 'false' || decrypted === '0') return false;
    } catch {}
    return Boolean(value);
  }
  return false;
};

const decryptNumber = (value: unknown): number | null => {
  const text = decryptText(value);
  if (text == null || text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

export const db = {
  // Notes
  async getAllNotes(): Promise<(Note & { pendingSync?: boolean; deleted?: boolean })[]> {
    const db = await initDB();
    const notes = await db.getAll('notes');
    return notes.map(n => ({
        ...n,
        title: decrypt(n.title),
        content: decrypt(n.content),
        tags: n.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: n.icon ? (() => { try { return decrypt(n.icon) } catch { return n.icon } })() : undefined,
        iconColor: n.iconColor ? (() => { try { return decrypt(n.iconColor) } catch { return n.iconColor } })() : undefined,
        type: n.type ? (() => { try { return decrypt(n.type) as any } catch { return n.type } })() : 'note',
        parentId: n.parentId ? (() => { try { return decrypt(n.parentId) } catch { return n.parentId } })() : null,
        order: (() => {
            const parsed = decryptNumber((n as any).order);
            if (parsed !== null) return parsed;
            if (typeof (n as any).order === 'number') return (n as any).order;
            if (typeof (n as any).order === 'string') {
                const fallback = Number((n as any).order);
                return Number.isFinite(fallback) ? fallback : 0;
            }
            return 0;
        })(),
        userId: decryptText((n as any).userId, (n as any).userId) || (n as any).userId,
        clientId: (n as any).clientId ? (decryptText((n as any).clientId, (n as any).clientId) || (n as any).clientId) : undefined,
        locked: (() => {
            const value: any = (n as any).locked;
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
        })(),
        password: (n as any).password ? (decryptText((n as any).password, (n as any).password) || (n as any).password) : undefined,
        createdAt: (() => {
            const value: any = (n as any).createdAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        updatedAt: (() => {
            const value: any = (n as any).updatedAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        pendingSync: parseEncryptedBool((n as any).pendingSync),
        deleted: parseEncryptedBool((n as any).deleted),
    }));
  },

  async getNote(id: string): Promise<(Note & { pendingSync?: boolean; deleted?: boolean }) | undefined> {
    const db = await initDB();
    const note = await db.get('notes', id);
    if (!note) return undefined;
    return {
        ...note,
        title: decrypt(note.title),
        content: decrypt(note.content),
        tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
        iconColor: note.iconColor ? (() => { try { return decrypt(note.iconColor) } catch { return note.iconColor } })() : undefined,
        type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
        parentId: note.parentId ? (() => { try { return decrypt(note.parentId) } catch { return note.parentId } })() : null,
        order: (() => {
            const parsed = decryptNumber((note as any).order);
            if (parsed !== null) return parsed;
            if (typeof (note as any).order === 'number') return (note as any).order;
            if (typeof (note as any).order === 'string') {
                const fallback = Number((note as any).order);
                return Number.isFinite(fallback) ? fallback : 0;
            }
            return 0;
        })(),
        userId: decryptText((note as any).userId, (note as any).userId) || (note as any).userId,
        clientId: (note as any).clientId ? (decryptText((note as any).clientId, (note as any).clientId) || (note as any).clientId) : undefined,
        locked: (() => {
            const value: any = (note as any).locked;
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
        })(),
        password: (note as any).password ? (decryptText((note as any).password, (note as any).password) || (note as any).password) : undefined,
        createdAt: (() => {
            const value: any = (note as any).createdAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        updatedAt: (() => {
            const value: any = (note as any).updatedAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        pendingSync: parseEncryptedBool((note as any).pendingSync),
        deleted: parseEncryptedBool((note as any).deleted),
    };
  },

  async saveNote(note: Note, pendingSync = false): Promise<void> {
    const db = await initDB();
    const encrypted: any = {
        _id: note._id,
        userId: note.userId ? encrypt(note.userId) : note.userId,
        clientId: note.clientId ? encrypt(note.clientId) : note.clientId,
        title: encrypt(note.title),
        content: encrypt(note.content),
        tags: note.tags?.map(t => encrypt(t)) ?? [],
        icon: note.icon ? encrypt(note.icon) : undefined,
        iconColor: note.iconColor ? encrypt(note.iconColor) : undefined,
        parentId: note.parentId ? encrypt(note.parentId) : null,
        order: typeof note.order === 'number' ? encrypt(String(note.order)) : note.order ? encrypt(String(note.order)) : undefined,
        locked: encrypt(String(!!note.locked)),
        password: note.password ? encrypt(note.password) : note.password,
        createdAt: encrypt(String(note.createdAt)),
        updatedAt: encrypt(String(note.updatedAt)),
        type: note.type ? encrypt(note.type) : note.type,
        pendingSync: encrypt(String(!!pendingSync)),
        deleted: (note as any).deleted !== undefined ? encrypt(String(!!(note as any).deleted)) : (note as any).deleted
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
          await db.put('notes', { ...note, deleted: encrypt('true'), pendingSync: encrypt('true') });
      }
  },

  async getPendingSyncNotes(): Promise<(Note & { deleted?: boolean })[]> {
    const db = await initDB();
    const all = await db.getAll('notes');
    const pending = all.filter((n) => parseEncryptedBool((n as any).pendingSync));
    return pending.map(n => ({
        ...n,
        title: decrypt(n.title),
        content: decrypt(n.content),
        tags: n.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: n.icon ? (() => { try { return decrypt(n.icon) } catch { return n.icon } })() : undefined,
        iconColor: n.iconColor ? (() => { try { return decrypt(n.iconColor) } catch { return n.iconColor } })() : undefined,
        type: n.type ? (() => { try { return decrypt(n.type) as any } catch { return n.type } })() : 'note',
        parentId: n.parentId ? (() => { try { return decrypt(n.parentId) } catch { return n.parentId } })() : null,
        order: (() => {
            const parsed = decryptNumber((n as any).order);
            if (parsed !== null) return parsed;
            if (typeof (n as any).order === 'number') return (n as any).order;
            if (typeof (n as any).order === 'string') {
                const fallback = Number((n as any).order);
                return Number.isFinite(fallback) ? fallback : 0;
            }
            return 0;
        })(),
        userId: decryptText((n as any).userId, (n as any).userId) || (n as any).userId,
        clientId: (n as any).clientId ? (decryptText((n as any).clientId, (n as any).clientId) || (n as any).clientId) : undefined,
        locked: (() => {
            const value: any = (n as any).locked;
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
        })(),
        password: (n as any).password ? (decryptText((n as any).password, (n as any).password) || (n as any).password) : undefined,
        createdAt: (() => {
            const value: any = (n as any).createdAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        updatedAt: (() => {
            const value: any = (n as any).updatedAt;
            if (typeof value !== 'string') return new Date().toISOString();
            try {
                const decrypted = decrypt(value);
                return decrypted || value;
            } catch {
                return value;
            }
        })(),
        pendingSync: true,
        deleted: parseEncryptedBool((n as any).deleted),
    }));
  },

  // Tasks
  async getAllTasks(): Promise<(Task & { pendingSync?: boolean; deleted?: boolean })[]> {
    const db = await initDB();
    const tasks = await db.getAll('tasks');
    return tasks.map(t => ({
      ...t,
      title: decrypt(t.title),
      description: t.description ? decrypt(t.description) : '',
      completed: parseTaskCompleted((t as any).completed),
      priority: parseTaskPriority((t as any).priority),
      dueDate: t.dueDate ? (() => { try { return decrypt(t.dueDate) } catch { return t.dueDate } })() : null,
      createdAt: decryptText(t.createdAt, t.createdAt) || t.createdAt,
      updatedAt: decryptText(t.updatedAt, t.updatedAt) || t.updatedAt,
      userId: decryptText((t as any).userId, (t as any).userId) || (t as any).userId,
      parentNoteId: (t as any).parentNoteId ? (decryptText((t as any).parentNoteId, (t as any).parentNoteId) || (t as any).parentNoteId) : null,
      parentId: (t as any).parentId ? (decryptText((t as any).parentId, (t as any).parentId) || (t as any).parentId) : null,
      position: (() => {
        const parsed = decryptNumber((t as any).position);
        if (parsed !== null) return parsed;
        if (typeof (t as any).position === 'number') return (t as any).position;
        return 0;
      })(),
      clientId: (t as any).clientId ? (decryptText((t as any).clientId, (t as any).clientId) || (t as any).clientId) : undefined,
      pendingSync: parseEncryptedBool((t as any).pendingSync),
      deleted: parseEncryptedBool((t as any).deleted)
    }));
  },

  async saveTask(task: Task, pendingSync = false): Promise<void> {
    const db = await initDB();
    const encrypted = {
        _id: task._id,
        userId: task.userId ? encrypt(task.userId) : task.userId,
        clientId: task.clientId ? encrypt(task.clientId) : task.clientId,
        title: encrypt(task.title),
        description: encrypt(task.description || ''),
        completed: encrypt(String(task.completed)),
        priority: encrypt(task.priority),
        dueDate: task.dueDate ? encrypt(String(task.dueDate)) : null,
        createdAt: encrypt(String(task.createdAt)),
        updatedAt: encrypt(String(task.updatedAt)),
        parentNoteId: task.parentNoteId ? encrypt(task.parentNoteId) : null,
        parentId: task.parentId ? encrypt(task.parentId) : null,
        position: typeof task.position === 'number' ? encrypt(String(task.position)) : task.position ? encrypt(String(task.position)) : undefined,
        pendingSync: encrypt(String(!!pendingSync)),
        deleted: (task as any).deleted !== undefined ? encrypt(String(!!(task as any).deleted)) : (task as any).deleted
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
          await db.put('tasks', { ...task, deleted: encrypt('true'), pendingSync: encrypt('true') });
      }
  },

  async getPendingSyncTasks(): Promise<(Task & { deleted?: boolean })[]> {
    const db = await initDB();
    const all = await db.getAll('tasks');
    const pending = all.filter((t) => parseEncryptedBool((t as any).pendingSync));
    return pending.map(t => ({
      ...t,
      title: decrypt(t.title),
      description: t.description ? decrypt(t.description) : '',
      completed: parseTaskCompleted((t as any).completed),
      priority: parseTaskPriority((t as any).priority),
      dueDate: t.dueDate ? (() => { try { return decrypt(t.dueDate) } catch { return t.dueDate } })() : null,
      createdAt: decryptText(t.createdAt, t.createdAt) || t.createdAt,
      updatedAt: decryptText(t.updatedAt, t.updatedAt) || t.updatedAt,
      userId: decryptText((t as any).userId, (t as any).userId) || (t as any).userId,
      parentNoteId: (t as any).parentNoteId ? (decryptText((t as any).parentNoteId, (t as any).parentNoteId) || (t as any).parentNoteId) : null,
      parentId: (t as any).parentId ? (decryptText((t as any).parentId, (t as any).parentId) || (t as any).parentId) : null,
      position: (() => {
        const parsed = decryptNumber((t as any).position);
        if (parsed !== null) return parsed;
        if (typeof (t as any).position === 'number') return (t as any).position;
        return 0;
      })(),
      clientId: (t as any).clientId ? (decryptText((t as any).clientId, (t as any).clientId) || (t as any).clientId) : undefined,
      pendingSync: true,
      deleted: parseEncryptedBool((t as any).deleted),
    }));
  }
};
