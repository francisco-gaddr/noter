import * as SQLite from 'expo-sqlite';
import { Note, Task, encrypt, decrypt } from '@repo/shared';

const db = SQLite.openDatabaseSync('noter.db');

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
};

const toIsoStringOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
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
      clientId TEXT,
      position REAL,
      recurrenceType TEXT,
      recurrenceDays TEXT,
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
      await db.execAsync('ALTER TABLE tasks ADD COLUMN parentId TEXT');
  } catch (e) {
  }
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN clientId TEXT');
  } catch (e) {
  }
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN position REAL');
  } catch (e) {
  }
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN recurrenceType TEXT');
  } catch (e) {
  }
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN recurrenceDays TEXT');
  } catch (e) {
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
    await db.execAsync('ALTER TABLE sync_queue ADD COLUMN dedupeKey TEXT');
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
      parsed = JSON.parse(row.data);
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
  
  // Encrypt metadata
  const encryptedTags = encrypt(JSON.stringify(note.tags || []));
  const encryptedIcon = note.icon ? encrypt(note.icon) : null;
  const encryptedType = (note as any).type ? encrypt((note as any).type) : null;
  
  const createdAt = toIsoString(note.createdAt);
  const updatedAt = toIsoString(note.updatedAt);

  await db.runAsync(
    `INSERT OR REPLACE INTO notes (_id, title, content, tags, createdAt, updatedAt, userId, type, parentId, noteOrder, icon, locked, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note._id,
      encryptedTitle,
      encryptedContent,
      encryptedTags,
      createdAt.toString(),
      updatedAt.toString(),
      note.userId,
      encryptedType,
      note.parentId || null,
      typeof (note as any).order === 'number' ? (note as any).order : null,
      encryptedIcon,
      note.locked ? 1 : 0,
      isSynced ? 1 : 0
    ]
  );
};

export const getNotesLocal = async (): Promise<Note[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM notes ORDER BY updatedAt DESC');
  return result.map(row => {
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
            } else {
                type = row.type; // Fallback
            }
        } catch {
            type = row.type; // Legacy
        }
    }

    let locked = false;
    if (typeof row.locked === 'number') {
      locked = row.locked === 1;
    } else if (typeof row.locked === 'string') {
      if (row.locked === 'true' || row.locked === '1') {
        locked = true;
      } else if (row.locked === 'false' || row.locked === '0') {
        locked = false;
      } else {
        try {
          locked = decrypt(row.locked) === 'true';
        } catch {
          locked = false;
        }
      }
    } else {
      locked = !!row.locked;
    }

    return {
        _id: row._id,
        title: decrypt(row.title),
        content: decrypt(row.content),
        tags: tags,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        userId: row.userId,
        type: type,
        parentId: row.parentId,
        order: typeof row.noteOrder === 'number' ? row.noteOrder : 0,
        icon: icon,
        locked: locked,
    };
  });
};

export const deleteNoteLocal = async (id: string) => {
  await db.runAsync('DELETE FROM notes WHERE _id = ?', [id]);
};

export const saveTaskLocal = async (task: Task, isSynced: boolean = true) => {
  const encryptedTitle = encrypt(task.title);
  const encryptedDescription = task.description ? encrypt(task.description) : '';
  const encryptedPriority = encrypt(task.priority);
  const encryptedCompleted = encrypt(String(task.completed));
  const encryptedRecurrenceType = task.recurrenceType ? encrypt(task.recurrenceType) : '';
  const encryptedRecurrenceDays = task.recurrenceDays ? encrypt(JSON.stringify(task.recurrenceDays)) : '';
  
  const createdAt = toIsoString(task.createdAt);
  const updatedAt = toIsoString(task.updatedAt);
  
  let encryptedDueDate: string | null = null;
  if (task.dueDate) {
      const isoDate = toIsoString(task.dueDate);
      encryptedDueDate = encrypt(isoDate);
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO tasks (_id, title, description, priority, completed, dueDate, createdAt, updatedAt, userId, parentNoteId, parentId, clientId, position, recurrenceType, recurrenceDays, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task._id,
      encryptedTitle,
      encryptedDescription,
      encryptedPriority,
      encryptedCompleted,
      encryptedDueDate,
      createdAt.toString(),
      updatedAt.toString(),
      task.userId,
      task.parentNoteId || null,
      task.parentId || null,
      task.clientId || null,
      typeof task.position === 'number' ? task.position : null,
      encryptedRecurrenceType,
      encryptedRecurrenceDays,
      isSynced ? 1 : 0
    ]
  );
};

export const getTasksLocal = async (): Promise<Task[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM tasks ORDER BY createdAt DESC');
  return result.map(row => {
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
            // Fallback for legacy
            dueDate = row.dueDate;
        }
    }

    return {
        _id: row._id,
        title: decrypt(row.title),
        description: row.description ? decrypt(row.description) : '',
        priority: priority,
        completed: completed,
        dueDate: dueDate,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        userId: row.userId,
        parentNoteId: row.parentNoteId,
        clientId: row.clientId,
        parentId: row.parentId,
        position: row.position,
        recurrenceType: row.recurrenceType ? (() => { try { return decrypt(row.recurrenceType) as any } catch { return 'none' as any } })() : 'none',
        recurrenceDays: row.recurrenceDays ? (() => { try { return JSON.parse(decrypt(row.recurrenceDays)) } catch { return [] } })() : []
    } as unknown as Task;
  });
};

export const deleteTaskLocal = async (id: string) => {
  await db.runAsync('DELETE FROM tasks WHERE _id = ?', [id]);
};

export const addToSyncQueue = async (action: string, entity: string, data: any) => {
  const dedupeKey = computeSyncDedupeKey(action, entity, data);
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_queue (action, entity, data, timestamp, dedupeKey) VALUES (?, ?, ?, ?, ?)`,
    [action, entity, JSON.stringify(data), new Date().toISOString(), dedupeKey]
  );
};

export const getSyncQueue = async () => {
  const result = await db.getAllAsync<any>('SELECT * FROM sync_queue ORDER BY timestamp ASC');
  return result.map(row => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    data: JSON.parse(row.data),
    timestamp: row.timestamp
  }));
};

export const removeFromSyncQueue = async (id: number) => {
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
};
