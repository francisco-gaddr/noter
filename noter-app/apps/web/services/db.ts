import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Note, Task, Conversation, Message, AIModel, encrypt, decrypt } from '@repo/shared';

type LocalConversation = Conversation & { localOnly?: boolean };

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
  conversations: {
    key: string;
    value: LocalConversation;
    indexes: { 'by-updated': string };
  };
  messages: {
    key: string;
    value: Message & { conversationId: string };
    indexes: { 'by-conversation': string };
  };
  models: {
    key: string;
    value: AIModel;
  };
}

const DB_NAME = 'noter-db';
const DB_VERSION = 3;

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
        if (oldVersion < 3) {
            const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
            convStore.createIndex('by-updated', 'updatedAt');
            
            const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
            msgStore.createIndex('by-conversation', 'conversationId');
            
            db.createObjectStore('models', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

export const clearNotesAndTasks = async () => {
  const db = await initDB();
  await db.clear('notes');
  await db.clear('tasks');
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
    return notes.map(n => {
        const locked = (() => {
            const value: any = (n as any).locked;
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number') return value === 1;
            if (typeof value === 'string') {
                if (value === 'true') return true;
                if (value === 'false') return false;
                try {
                    return decrypt(value) === 'true';
                } catch {
                    return false;
                }
            }
            return false;
        })();
        return {
          ...n,
          title: n.title,
          content: n.content,
          tags: n.tags ?? [],
          icon: n.icon,
          iconColor: n.iconColor,
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
          locked: locked,
          __rawEncryptedTitle: n.title,
          __rawEncryptedContent: n.content,
          __rawEncryptedTags: n.tags ?? [],
          __rawEncryptedIcon: n.icon,
          __rawEncryptedIconColor: n.iconColor,
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
        } as any;
    });
  },

  async getNote(id: string): Promise<(Note & { pendingSync?: boolean; deleted?: boolean }) | undefined> {
    const db = await initDB();
    const note = await db.get('notes', id);
    if (!note) return undefined;
    const locked = (() => {
        const value: any = (note as any).locked;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
            if (value === 'true') return true;
            if (value === 'false') return false;
            try {
                return decrypt(value) === 'true';
            } catch {
                return false;
            }
        }
        return false;
    })();
    return {
        ...note,
        title: note.title,
        content: note.content,
        tags: note.tags ?? [],
        icon: note.icon,
        iconColor: note.iconColor,
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
        locked: locked,
        __rawEncryptedTitle: note.title,
        __rawEncryptedContent: note.content,
        __rawEncryptedTags: note.tags ?? [],
        __rawEncryptedIcon: note.icon,
        __rawEncryptedIconColor: note.iconColor,
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
    } as any;
  },

  async saveNote(note: Note, pendingSync = false): Promise<void> {
    const db = await initDB();
    const rawTitle = (note as any).__rawEncryptedTitle;
    const rawContent = (note as any).__rawEncryptedContent;
    const rawTags = (note as any).__rawEncryptedTags;
    const rawIcon = (note as any).__rawEncryptedIcon;
    const rawIconColor = (note as any).__rawEncryptedIconColor;
    const encrypted: any = {
        _id: note._id,
        userId: note.userId ? encrypt(note.userId) : note.userId,
        clientId: note.clientId ? encrypt(note.clientId) : note.clientId,
        title: rawTitle && note.locked ? rawTitle : encrypt(note.title),
        content: rawContent && note.locked ? rawContent : encrypt(note.content),
        tags: Array.isArray(rawTags) && note.locked ? rawTags : (note.tags?.map(t => encrypt(t)) ?? []),
        icon: rawIcon && note.locked ? rawIcon : (note.icon ? encrypt(note.icon) : undefined),
        iconColor: rawIconColor && note.locked ? rawIconColor : (note.iconColor ? encrypt(note.iconColor) : undefined),
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
  },

  // AI Conversations

  async saveConversation(conversation: LocalConversation): Promise<void> {
    const db = await initDB();
    const encrypted: LocalConversation = {
      ...conversation,
      title: encrypt(conversation.title),
      model: conversation.model ? encrypt(conversation.model) : undefined,
      projectId: conversation.projectId ? encrypt(conversation.projectId) : undefined,
      icon: conversation.icon ? encrypt(conversation.icon) : undefined,
      iconColor: conversation.iconColor ? encrypt(conversation.iconColor) : undefined,
      localOnly: encrypt(String(Boolean(conversation.localOnly))) as any,
      userId: conversation.userId ? encrypt(conversation.userId) : undefined,
      createdAt: encrypt(conversation.createdAt),
      updatedAt: encrypt(conversation.updatedAt),
    };
    await db.put('conversations', encrypted);
  },

  async getConversations(userId?: string): Promise<LocalConversation[]> {
    const db = await initDB();
    const encrypted = await db.getAllFromIndex('conversations', 'by-updated');
    return encrypted.map(conv => ({
      ...conv,
      title: decrypt(conv.title),
      model: conv.model ? decrypt(conv.model) : undefined,
      projectId: conv.projectId ? decryptText(conv.projectId, conv.projectId) || conv.projectId : undefined,
      icon: conv.icon ? decryptText(conv.icon, conv.icon) || conv.icon : undefined,
      iconColor: conv.iconColor ? decryptText(conv.iconColor, conv.iconColor) || conv.iconColor : undefined,
      localOnly: conv.localOnly ? (decryptText(conv.localOnly as any, String(conv.localOnly)) === 'true') : false,
      userId: conv.userId ? decryptText(conv.userId, conv.userId) || conv.userId : undefined,
      createdAt: decrypt(conv.createdAt),
      updatedAt: decrypt(conv.updatedAt),
      messages: []
    })).reverse().filter(conv => !userId || conv.userId === userId || !conv.userId);
  },

  async deleteConversation(id: string): Promise<void> {
    const db = await initDB();
    await db.delete('conversations', id);
  },

  // AI Messages

  async saveMessage(conversationId: string, message: Message): Promise<void> {
    const db = await initDB();
    const encrypted: Message & { conversationId: string } = {
      ...message,
      conversationId,
      role: encrypt(message.role) as any,
      content: encrypt(message.content),
      toolCalls: message.toolCalls ? encrypt(JSON.stringify(message.toolCalls)) as any : undefined,
      toolCallId: message.toolCallId ? encrypt(message.toolCallId) : undefined,
      createdAt: encrypt(message.createdAt)
    };
    await db.put('messages', encrypted);
  },

  async getMessages(conversationId: string): Promise<Message[]> {
    const db = await initDB();
    const encrypted = await db.getAllFromIndex('messages', 'by-conversation', conversationId);
    return encrypted.map(msg => {
      let toolCalls = undefined;
      if (msg.toolCalls) {
        try {
          toolCalls = JSON.parse(decrypt(msg.toolCalls as any));
        } catch {}
      }
      return {
        id: msg.id,
        role: decrypt(msg.role) as any,
        content: decrypt(msg.content),
        toolCalls,
        toolCallId: msg.toolCallId ? decrypt(msg.toolCallId) : undefined,
        createdAt: decrypt(msg.createdAt)
      };
    }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  // AI Models

  async saveModel(model: AIModel): Promise<void> {
    const db = await initDB();
    const encrypted: any = {
      ...model,
      name: encrypt(model.name),
      filename: encrypt(model.filename),
      path: encrypt(model.path),
      quantization: model.quantization ? encrypt(model.quantization) : undefined,
      size: encrypt(String(model.size)),
      downloaded: encrypt(String(model.downloaded))
    };
    await db.put('models', encrypted);
  },

  async getModels(): Promise<AIModel[]> {
    const db = await initDB();
    const encrypted = await db.getAll('models');
    return encrypted.map(model => ({
      ...model,
      name: decrypt(model.name),
      filename: decrypt(model.filename),
      path: decrypt(model.path),
      quantization: model.quantization ? decrypt(model.quantization) : undefined,
      size: Number(decrypt((model as any).size)),
      downloaded: decrypt((model as any).downloaded) === 'true'
    }));
  },

  async deleteModel(id: string): Promise<void> {
    const db = await initDB();
    await db.delete('models', id);
  }
};
