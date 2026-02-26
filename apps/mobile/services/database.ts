import * as SQLite from 'expo-sqlite';
import { Note, Task, encrypt, decrypt } from '@repo/shared';

const db = SQLite.openDatabaseSync('noter.db');

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
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

const encryptText = (value: unknown): string => encrypt(String(value ?? ''));

const decryptNumber = (value: unknown): number | null => {
  const text = decryptText(value);
  if (text == null || text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

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
      type TEXT,
      parentId TEXT,
      noteOrder REAL,
      icon TEXT,
      iconColor TEXT,
      locked INTEGER DEFAULT 0,
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
      dedupeKey TEXT
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
    await db.execAsync('ALTER TABLE sync_queue ADD COLUMN dedupeKey TEXT');
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

  await db.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_dedupeKey ON sync_queue(dedupeKey)');

  const existing = await db.getAllAsync<any>(
    'SELECT id, action, entity, data, dedupeKey FROM sync_queue ORDER BY timestamp ASC'
  );
  const seen = new Set<string>();
  for (const row of existing) {
    if (typeof row.dedupeKey === 'string' && row.dedupeKey.length > 0) {
      if (seen.has(row.dedupeKey)) {
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
        continue;
      }
      seen.add(row.dedupeKey);
      continue;
    }

    let parsed: any = null;
    try {
      const decrypted = decryptText(row.data, row.data) || row.data;
      parsed = JSON.parse(decrypted);
    } catch {
      parsed = null;
    }
    const dedupeKey = computeSyncDedupeKey(row.action, row.entity, parsed);
    if (!dedupeKey) continue;

    if (seen.has(dedupeKey)) {
      await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
      continue;
    }
    seen.add(dedupeKey);
    await db.runAsync('UPDATE sync_queue SET dedupeKey = ? WHERE id = ?', [dedupeKey, row.id]);
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
  const encryptedParentId = note.parentId ? encryptText(note.parentId) : null;
  const encryptedOrder = typeof (note as any).order === 'number' ? encryptText((note as any).order) : null;
  
  const createdAt = toIsoString(note.createdAt);
  const updatedAt = toIsoString(note.updatedAt);
  const encryptedCreatedAt = encrypt(createdAt.toString());
  const encryptedUpdatedAt = encrypt(updatedAt.toString());
  const encryptedLocked = encrypt(String(!!note.locked));

  await db.runAsync(
    `INSERT OR REPLACE INTO notes (_id, title, content, tags, createdAt, updatedAt, userId, type, parentId, noteOrder, icon, iconColor, locked, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note._id,
      encryptedTitle,
      encryptedContent,
      encryptedTags,
      encryptedCreatedAt,
      encryptedUpdatedAt,
      encryptedUserId,
      encryptedType,
      encryptedParentId,
      encryptedOrder,
      encryptedIcon,
      encryptedIconColor,
      encryptedLocked,
      isSynced ? 1 : 0
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

    let locked = false;
    if (row.locked !== null && row.locked !== undefined) {
        if (typeof row.locked === 'string') {
            try {
                locked = decrypt(row.locked) === 'true';
            } catch {
                locked = row.locked === '1' || row.locked === 'true';
            }
        } else {
            locked = !!row.locked;
        }
    }

    const iconColor = row.iconColor ? decryptText(row.iconColor, row.iconColor) : undefined;
    const userId = decryptText(row.userId, row.userId) || row.userId;
    const parentId = row.parentId ? decryptText(row.parentId, row.parentId) : null;
    const order = decryptNumber(row.noteOrder);

    return {
        _id: row._id,
        title: decrypt(row.title),
        content: decrypt(row.content),
        tags: tags,
        createdAt: createdAt,
        updatedAt: updatedAt,
        userId: userId,
        type: type,
        parentId: parentId,
        order: order ?? 0,
        icon: icon,
        iconColor: iconColor || undefined,
        locked: locked,
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
      isSynced ? 1 : 0
    ]
  );
};

export const getTasksLocal = async (): Promise<Task[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM tasks');
  const tasks = result.map(row => {
    let completed = false;
    try {
        completed = decrypt(row.completed) === 'true';
    } catch {
        // Fallback for legacy unencrypted data (0 or 1)
        completed = !!row.completed;
    }

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
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_queue (action, entity, data, timestamp, dedupeKey) VALUES (?, ?, ?, ?, ?)`,
    [action, entity, encryptedData, encrypt(new Date().toISOString()), dedupeKey]
  );
};

export const getSyncQueue = async () => {
  const result = await db.getAllAsync<any>('SELECT * FROM sync_queue ORDER BY timestamp ASC');
  return result.map(row => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    data: (() => {
      try {
        return JSON.parse(decrypt(row.data));
      } catch {
        try {
          return JSON.parse(row.data);
        } catch {
          return null;
        }
      }
    })(),
    timestamp: decryptText(row.timestamp, row.timestamp) || row.timestamp
  }));
};

export const removeFromSyncQueue = async (id: number) => {
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
};
