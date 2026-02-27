import * as SQLite from 'expo-sqlite';
import CryptoJS from 'crypto-js';
import { Note, Task, Conversation, Message, AIModel, encrypt, decrypt } from '@repo/shared';

const db = SQLite.openDatabaseSync('noter.db');

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
};

const decryptText = (value: unknown, fallback: string | null = null): string | null => {
  if (value == null) return fallback;
  const raw = typeof value === 'string' ? value : String(value);
  // Optimization: If raw looks like a valid encrypted string (base64, no spaces), try decrypt
  // Otherwise return raw. This prevents trying to decrypt already decrypted text or garbage.
  // For now, simple try/catch.
  try {
    const decrypted = decrypt(raw);
    return decrypted === '' && raw !== '' ? raw : decrypted;
  } catch {
    return raw;
  }
};

const encryptText = (value: unknown): string => encrypt(String(value ?? ''));

const decryptNumber = (value: unknown): number | null => {
  const text = decryptText(value);
  if (text == null || text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const decryptBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = decryptText(value);
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return text === 'true';
};

const hashText = (value: string): string => CryptoJS.SHA256(value).toString();

const computeSyncDedupeKey = (action: string, entity: string, data: any): string | null => {
  if (!action || !entity) return null;

  if (action === 'CREATE') {
    const tempId = typeof data?.tempId === 'string' ? data.tempId : null;
    const clientId = typeof data?.clientId === 'string' ? data.clientId : null;
    if (tempId) return `CREATE:${entity}:tempId:${tempId}`;
    if (clientId) return `CREATE:${entity}:clientId:${clientId}`;
    return null;
  }

  if (action === 'UPDATE' || action === 'DELETE') {
    const id = typeof data?.id === 'string' ? data.id : typeof data?._id === 'string' ? data._id : null;
    if (!id) return null;
    return `${action}:${entity}:id:${id}`;
  }

  if (action === 'REORDER') {
    return null;
  }

  return null;
};

export const initDatabase = async () => {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notes (
      _id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      tags TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      userId TEXT,
      clientId TEXT,
      type TEXT,
      parentId TEXT,
      noteOrder REAL,
      icon TEXT,
      iconColor TEXT,
      locked INTEGER DEFAULT 0,
      password TEXT,
      isSynced INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS tasks (
      _id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      priority TEXT,
      completed INTEGER DEFAULT 0,
      dueDate TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      userId TEXT,
      parentNoteId TEXT,
      parentId TEXT,
      position REAL,
      clientId TEXT,
      isSynced INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT,
      entity TEXT,
      data TEXT,
      timestamp TEXT,
      dedupeKey TEXT,
      dedupeKeyHash TEXT
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT,
      role TEXT,
      content TEXT,
      toolCalls TEXT,
      toolCallId TEXT,
      createdAt TEXT,
      FOREIGN KEY(conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT,
      filename TEXT,
      path TEXT,
      size INTEGER,
      quantization TEXT,
      downloaded INTEGER
    );
  `);
  
  // Migration for parentNoteId if it doesn't exist (primitive check)
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN parentNoteId TEXT');
  } catch (e) {
      // Column likely exists
  }
  
  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN parentId TEXT');
  } catch (e) {
      // Column likely exists
  }
  
  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN type TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN noteOrder REAL');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN icon TEXT');
  } catch (e) {
      // Column likely exists
  }
  
  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN iconColor TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN clientId TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE notes ADD COLUMN password TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
    await db.execAsync('ALTER TABLE sync_queue ADD COLUMN dedupeKey TEXT');
  } catch (e) {
    // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE sync_queue ADD COLUMN dedupeKeyHash TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN parentId TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN position REAL');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN clientId TEXT');
  } catch (e) {
      // Column likely exists
  }

  await db.execAsync('DROP INDEX IF EXISTS idx_sync_queue_dedupeKey');
  await db.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_dedupeKeyHash ON sync_queue(dedupeKeyHash)');

  const existing = await db.getAllAsync<any>(
    'SELECT id, action, entity, data, timestamp, dedupeKey, dedupeKeyHash FROM sync_queue'
  );
  const seen = new Set<string>();
  for (const row of existing) {
    const actionText = decryptText(row.action, row.action) || row.action;
    const entityText = decryptText(row.entity, row.entity) || row.entity;
    const dataText = decryptText(row.data, row.data) || row.data;
    const dedupeKeyText = decryptText(row.dedupeKey, row.dedupeKey) || row.dedupeKey;
    const timestampText = decryptText(row.timestamp, row.timestamp) || row.timestamp;

    let parsed: any = null;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      parsed = null;
    }
    const computedDedupeKey = dedupeKeyText || computeSyncDedupeKey(actionText, entityText, parsed);
    const hash = computedDedupeKey ? hashText(computedDedupeKey) : null;
    if (hash) {
      if (seen.has(hash)) {
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
        continue;
      }
      seen.add(hash);
    }

    await db.runAsync(
      'UPDATE sync_queue SET action = ?, entity = ?, data = ?, timestamp = ?, dedupeKey = ?, dedupeKeyHash = ? WHERE id = ?',
      [
        encryptText(actionText),
        encryptText(entityText),
        encryptText(dataText),
        encryptText(timestampText),
        computedDedupeKey ? encryptText(computedDedupeKey) : null,
        hash,
        row.id
      ]
    );
  }
};

export const saveNoteLocal = async (note: Note, isSynced: boolean = true) => {
  const encryptedTitle = encrypt(note.title);
  const encryptedContent = encrypt(note.content);
  
  const encryptedTags = encrypt(JSON.stringify(note.tags || []));
  const encryptedIcon = note.icon ? encrypt(note.icon) : null;
  const encryptedIconColor = (note as any).iconColor ? encrypt((note as any).iconColor) : null;
  const encryptedType = (note as any).type ? encrypt((note as any).type) : null;
  const encryptedUserId = encryptText(note.userId);
  const encryptedClientId = note.clientId ? encryptText(note.clientId) : null;
  const encryptedParentId = note.parentId ? encryptText(note.parentId) : null;
  const encryptedOrder = typeof (note as any).order === 'number' ? encryptText((note as any).order) : null;
  const encryptedPassword = note.password ? encryptText(note.password) : null;
  
  const createdAt = toIsoString(note.createdAt);
  const updatedAt = toIsoString(note.updatedAt);
  const encryptedCreatedAt = encrypt(createdAt.toString());
  const encryptedUpdatedAt = encrypt(updatedAt.toString());
  const encryptedLocked = encrypt(String(!!note.locked));
  const encryptedIsSynced = encryptText(isSynced ? '1' : '0');

  await db.runAsync(
    `INSERT OR REPLACE INTO notes (_id, title, content, tags, createdAt, updatedAt, userId, clientId, type, parentId, noteOrder, icon, iconColor, locked, password, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note._id,
      encryptedTitle,
      encryptedContent,
      encryptedTags,
      encryptedCreatedAt,
      encryptedUpdatedAt,
      encryptedUserId,
      encryptedClientId,
      encryptedType,
      encryptedParentId,
      encryptedOrder,
      encryptedIcon,
      encryptedIconColor,
      encryptedLocked,
      encryptedPassword,
      encryptedIsSynced
    ]
  );
};

export const getNotesLocal = async (): Promise<Note[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM notes');
  const notes = result.map(row => {
    let tags: string[] = [];
    try {
        const decryptedTags = decrypt(row.tags);
        tags = JSON.parse(decryptedTags);
    } catch {
        // Fallback for legacy plain JSON
        try {
            tags = JSON.parse(row.tags || '[]');
        } catch {
            tags = [];
        }
    }

    let icon: string | undefined = undefined;
    if (row.icon) {
        try {
            icon = decrypt(row.icon);
        } catch {
            icon = row.icon; // Legacy
        }
    }

    let type: 'note' | 'task_list' | 'project' | undefined = undefined;
    if (row.type) {
        try {
            const decryptedType = decrypt(row.type);
            if (['note', 'task_list', 'project'].includes(decryptedType)) {
                type = decryptedType as any;
            } else if (['note', 'task_list', 'project'].includes(row.type)) {
                type = row.type as any;
            } else {
                type = undefined;
            }
        } catch {
             if (['note', 'task_list', 'project'].includes(row.type)) {
                type = row.type as any;
            } else {
                type = undefined;
            }
        }
    }

    const createdAt = decryptText(row.createdAt, row.createdAt) || row.createdAt;
    const updatedAt = decryptText(row.updatedAt, row.updatedAt) || row.updatedAt;

    const locked = decryptBool(row.locked);

    const iconColor = row.iconColor ? decryptText(row.iconColor, row.iconColor) : undefined;
    const userId = decryptText(row.userId, row.userId) || row.userId;
    const clientId = row.clientId ? decryptText(row.clientId, row.clientId) : undefined;
    const parentId = row.parentId ? decryptText(row.parentId, row.parentId) : null;
    const order = decryptNumber(row.noteOrder);
    const password = row.password ? decryptText(row.password, row.password) : undefined;

    return {
        _id: row._id,
        title: decrypt(row.title),
        content: decrypt(row.content),
        tags: tags,
        createdAt: createdAt,
        updatedAt: updatedAt,
        userId: userId,
        clientId: clientId || undefined,
        type: type,
        parentId: parentId,
        order: order ?? 0,
        icon: icon,
        iconColor: iconColor || undefined,
        locked: locked,
        password: password || undefined,
    };
  });
  return notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const deleteNoteLocal = async (id: string) => {
  await db.runAsync('DELETE FROM notes WHERE _id = ?', [id]);
};

export const saveTaskLocal = async (task: Task, isSynced: boolean = true) => {
  const encryptedTitle = encrypt(task.title);
  const encryptedDescription = task.description ? encrypt(task.description) : '';
  const encryptedPriority = encrypt(task.priority);
  const encryptedCompleted = encrypt(String(task.completed));
  
  const createdAt = toIsoString(task.createdAt);
  const updatedAt = toIsoString(task.updatedAt);
  const encryptedCreatedAt = encrypt(createdAt.toString());
  const encryptedUpdatedAt = encrypt(updatedAt.toString());
  const encryptedUserId = encryptText(task.userId);
  const encryptedParentNoteId = task.parentNoteId ? encryptText(task.parentNoteId) : null;
  const encryptedParentId = task.parentId ? encryptText(task.parentId) : null;
  const encryptedPosition = typeof task.position === 'number' ? encryptText(task.position) : null;
  const encryptedClientId = task.clientId ? encryptText(task.clientId) : null;
  const encryptedIsSynced = encryptText(isSynced ? '1' : '0');
  
  let encryptedDueDate: string | null = null;
  if (task.dueDate) {
      const isoDate = toIsoString(task.dueDate);
      encryptedDueDate = encrypt(isoDate);
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO tasks (_id, title, description, priority, completed, dueDate, createdAt, updatedAt, userId, parentNoteId, parentId, position, clientId, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task._id,
      encryptedTitle,
      encryptedDescription,
      encryptedPriority,
      encryptedCompleted,
      encryptedDueDate,
      encryptedCreatedAt,
      encryptedUpdatedAt,
      encryptedUserId,
      encryptedParentNoteId,
      encryptedParentId,
      encryptedPosition,
      encryptedClientId,
      encryptedIsSynced
    ]
  );
};

export const getTasksLocal = async (): Promise<Task[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM tasks');
  const tasks = result.map(row => {
    const completed = decryptBool(row.completed);

    let priority: any = 'medium';
    try {
        priority = decrypt(row.priority);
        // Basic validation if decrypt returns garbage
        if (!['low', 'medium', 'high'].includes(priority)) {
             // If decrypt succeeded but returned something else (unlikely if valid iv), or if row.priority was plain text and decrypt threw?
             // Actually decrypt throws if IV is missing.
             // If row.priority is plain text "low", decrypt might fail or return garbage.
             // For legacy, we assume it might fail.
             if (['low', 'medium', 'high'].includes(row.priority)) {
                 priority = row.priority;
             }
        }
    } catch {
        priority = row.priority || 'medium';
    }

    let dueDate: string | null = null;
    if (row.dueDate) {
        try {
            const decryptedDate = decrypt(row.dueDate);
            dueDate = decryptedDate;
        } catch {
            dueDate = row.dueDate;
        }
    }

    const createdAt = decryptText(row.createdAt, row.createdAt) || row.createdAt;
    const updatedAt = decryptText(row.updatedAt, row.updatedAt) || row.updatedAt;
    const userId = decryptText(row.userId, row.userId) || row.userId;
    const parentNoteId = row.parentNoteId ? decryptText(row.parentNoteId, row.parentNoteId) : null;
    const parentId = row.parentId ? decryptText(row.parentId, row.parentId) : null;
    const position = decryptNumber(row.position);
    const clientId = row.clientId ? decryptText(row.clientId, row.clientId) : undefined;

    return {
        _id: row._id,
        title: decrypt(row.title),
        description: row.description ? decrypt(row.description) : '',
        priority: priority,
        completed: completed,
        dueDate: dueDate,
        createdAt: createdAt,
        updatedAt: updatedAt,
        userId: userId,
        parentNoteId: parentNoteId,
        clientId: clientId,
        parentId: parentId,
        position: position ?? 0
    } as unknown as Task;
  });
  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const deleteTaskLocal = async (id: string) => {
  await db.runAsync('DELETE FROM tasks WHERE _id = ?', [id]);
};

export const addToSyncQueue = async (action: string, entity: string, data: any) => {
  const dedupeKey = computeSyncDedupeKey(action, entity, data);
  const encryptedData = encrypt(JSON.stringify(data));
  const encryptedAction = encryptText(action);
  const encryptedEntity = encryptText(entity);
  const encryptedDedupeKey = dedupeKey ? encryptText(dedupeKey) : null;
  const dedupeKeyHash = dedupeKey ? hashText(dedupeKey) : null;
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_queue (action, entity, data, timestamp, dedupeKey, dedupeKeyHash) VALUES (?, ?, ?, ?, ?, ?)`,
    [encryptedAction, encryptedEntity, encryptedData, encryptText(new Date().toISOString()), encryptedDedupeKey, dedupeKeyHash]
  );
};

export const getSyncQueue = async () => {
  const result = await db.getAllAsync<any>('SELECT * FROM sync_queue');
  const queue = result.map(row => {
    const action = decryptText(row.action, row.action) || row.action;
    const entity = decryptText(row.entity, row.entity) || row.entity;
    const data = (() => {
      try {
        return JSON.parse(decryptText(row.data, row.data) || row.data);
      } catch {
        try {
          return JSON.parse(row.data);
        } catch {
          return null;
        }
      }
    })();
    const timestamp = decryptText(row.timestamp, row.timestamp) || row.timestamp;
    return { id: row.id, action, entity, data, timestamp };
  });
  return queue.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

export const removeFromSyncQueue = async (id: number) => {
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
};

// AI Conversations & Messages

export const saveConversationLocal = async (conversation: Conversation) => {
  const encryptedTitle = encrypt(conversation.title);
  const encryptedModel = conversation.model ? encrypt(conversation.model) : null;
  const encryptedCreatedAt = encrypt(conversation.createdAt);
  const encryptedUpdatedAt = encrypt(conversation.updatedAt);

  await db.runAsync(
    `INSERT OR REPLACE INTO conversations (id, title, model, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [conversation.id, encryptedTitle, encryptedModel, encryptedCreatedAt, encryptedUpdatedAt]
  );
};

export const getConversationsLocal = async (): Promise<Conversation[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM conversations ORDER BY updatedAt DESC');
  return result.map((row: any) => ({
    id: row.id,
    title: decrypt(row.title),
    model: row.model ? decrypt(row.model) : undefined,
    createdAt: decrypt(row.createdAt),
    updatedAt: decrypt(row.updatedAt),
    messages: []
  }));
};

export const deleteConversationLocal = async (id: string) => {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
};

export const saveMessageLocal = async (conversationId: string, message: Message) => {
  const encryptedRole = encrypt(message.role);
  const encryptedContent = encrypt(message.content);
  const encryptedToolCalls = message.toolCalls ? encrypt(JSON.stringify(message.toolCalls)) : null;
  const encryptedToolCallId = message.toolCallId ? encrypt(message.toolCallId) : null;
  const encryptedCreatedAt = encrypt(message.createdAt);

  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversationId, role, content, toolCalls, toolCallId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [message.id, conversationId, encryptedRole, encryptedContent, encryptedToolCalls, encryptedToolCallId, encryptedCreatedAt]
  );
};

export const getMessagesLocal = async (conversationId: string): Promise<Message[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC', [conversationId]);
  return result.map((row: any) => {
    let toolCalls = undefined;
    if (row.toolCalls) {
      try {
        toolCalls = JSON.parse(decrypt(row.toolCalls));
      } catch {}
    }
    return {
      id: row.id,
      role: decrypt(row.role) as any,
      content: decrypt(row.content),
      toolCalls,
      toolCallId: row.toolCallId ? decrypt(row.toolCallId) : undefined,
      createdAt: decrypt(row.createdAt)
    };
  });
};

// AI Models

export const saveModelLocal = async (model: AIModel) => {
  const encryptedName = encrypt(model.name);
  const encryptedFilename = encrypt(model.filename);
  const encryptedPath = encrypt(model.path);
  const encryptedQuantization = model.quantization ? encrypt(model.quantization) : null;
  const encryptedSize = encrypt(String(model.size));
  const encryptedDownloaded = encrypt(String(model.downloaded));

  await db.runAsync(
    `INSERT OR REPLACE INTO models (id, name, filename, path, size, quantization, downloaded)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [model.id, encryptedName, encryptedFilename, encryptedPath, encryptedSize, encryptedQuantization, encryptedDownloaded]
  );
};

export const getModelsLocal = async (): Promise<AIModel[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM models');
  return result.map((row: any) => ({
    id: row.id,
    name: decrypt(row.name),
    filename: decrypt(row.filename),
    path: decrypt(row.path),
    size: (() => { try { return Number(decrypt(row.size)); } catch { return Number(row.size); } })(),
    quantization: row.quantization ? decrypt(row.quantization) : undefined,
    downloaded: (() => { try { return decrypt(row.downloaded) === 'true'; } catch { return Boolean(row.downloaded); } })()
  }));
};

export const deleteModelLocal = async (id: string) => {
  await db.runAsync('DELETE FROM models WHERE id = ?', [id]);
};
