import * as SQLite from 'expo-sqlite';
import CryptoJS from 'crypto-js';
import { Note, Task, Conversation, Message, AIModel, AIProject, encrypt, decrypt, decryptWithSource } from '@repo/shared';
import { recordSyncQueueEnqueue, recordSyncQueueMergeIntoCreate, recordSyncQueueRemoveQueuedCreate } from './perfMetrics';

type LocalConversation = Conversation & { localOnly?: boolean };
type LocalAIProject = AIProject & { localOnly?: boolean };

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
  try {
    // Only attempt decryption if it looks like it might be encrypted (no spaces, length check)
    // Encrypted strings are usually base64 and longer. Simple heuristic.
    // Also skip if it starts with { or [ as it might be JSON (which implies not encrypted string)
    if (raw.includes(' ') || raw.length < 10 || raw.startsWith('{') || raw.startsWith('[')) return raw;

    const decrypted = decrypt(raw);
    // Handle malformed UTF-8 or empty result from decrypt
    if (!decrypted) return raw;
    // Check if result is valid UTF-8 string (not strictly needed in JS but good sanity check)
    return decrypted;
  } catch (e) {
    // If decryption fails (e.g. Malformed UTF-8 data), return raw value
    // This handles cases where data might not be encrypted or is corrupted
    return raw;
  }
};

const encryptText = (value: unknown): string => encrypt(String(value ?? ''));
const decryptDisplayText = (value: unknown, fallback = ''): string => {
  if (value == null) return fallback;
  const raw = typeof value === 'string' ? value : String(value);
  const result = decryptWithSource(raw);
  return result.source === 'failed' ? fallback : result.value;
};
const shouldReencrypt = (value: unknown) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const result = decryptWithSource(value);
  if (result.source === 'legacy' || result.source === 'plaintext') {
    return encrypt(result.value);
  }
  return null;
};

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
    const items = Array.isArray(data?.notes)
      ? data.notes
      : Array.isArray(data?.tasks)
        ? data.tasks
        : [];
    const ids = items
      .map((item: any) => (typeof item?._id === 'string' ? item._id : null))
      .filter((value: string | null): value is string => Boolean(value))
      .sort();
    if (ids.length === 0) return `REORDER:${entity}`;
    return `REORDER:${entity}:ids:${ids.join(',')}`;
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
      recurrenceType TEXT,
      recurrenceDays TEXT,
      reminderEnabled TEXT,
      reminderOffsetMinutes TEXT,
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
      projectId TEXT,
      icon TEXT,
      iconColor TEXT,
      localOnly TEXT,
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
    CREATE TABLE IF NOT EXISTS ai_projects (
      id TEXT PRIMARY KEY,
      userId TEXT,
      name TEXT,
      systemPrompt TEXT,
      icon TEXT,
      iconColor TEXT,
      localOnly TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  
  // Migration for parentNoteId if it doesn't exist (primitive check)
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN parentNoteId TEXT');
  } catch (e) {
      // Column likely exists
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
      await db.execAsync('ALTER TABLE tasks ADD COLUMN reminderEnabled TEXT');
  } catch (e) {
  }
  try {
      await db.execAsync('ALTER TABLE tasks ADD COLUMN reminderOffsetMinutes TEXT');
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
      await db.execAsync('ALTER TABLE notes ADD COLUMN iconColor TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE conversations ADD COLUMN icon TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE conversations ADD COLUMN iconColor TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE ai_projects ADD COLUMN icon TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE ai_projects ADD COLUMN iconColor TEXT');
  } catch (e) {
      // Column likely exists
  }
  try {
      await db.execAsync('ALTER TABLE ai_projects ADD COLUMN userId TEXT');
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
      await db.execAsync('ALTER TABLE conversations ADD COLUMN projectId TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE conversations ADD COLUMN localOnly TEXT');
  } catch (e) {
      // Column likely exists
  }

  try {
      await db.execAsync('ALTER TABLE ai_projects ADD COLUMN localOnly TEXT');
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
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_notes_updatedAt ON notes(updatedAt)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_notes_parentId ON notes(parentId)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_notes_clientId ON notes(clientId)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_notes_isSynced ON notes(isSynced)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_parentNoteId ON tasks(parentNoteId)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_parentId ON tasks(parentId)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_clientId ON tasks(clientId)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_isSynced ON tasks(isSynced)');

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
  const encryptedTitle = (note as any).__rawEncryptedTitle && note.locked ? (note as any).__rawEncryptedTitle : encrypt(note.title);
  const encryptedContent = (note as any).__rawEncryptedContent && note.locked ? (note as any).__rawEncryptedContent : encrypt(note.content);
  
  const encryptedTags = (() => {
    const raw = (note as any).__rawEncryptedTags;
    if (note.locked && typeof raw === 'string') return raw;
    if (note.locked && Array.isArray(raw)) return encrypt(JSON.stringify(raw));
    return encrypt(JSON.stringify(note.tags || []));
  })();
  const encryptedIcon = (note as any).__rawEncryptedIcon && note.locked ? (note as any).__rawEncryptedIcon : (note.icon ? encrypt(note.icon) : null);
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
    const createdAt = decryptText(row.createdAt, row.createdAt) || row.createdAt;
    const updatedAt = decryptText(row.updatedAt, row.updatedAt) || row.updatedAt;

    const locked = decryptBool(row.locked);

    const tags: any = row.tags;
    const icon: string | undefined = row.icon || undefined;

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

    const iconColor = row.iconColor ? decryptText(row.iconColor, row.iconColor) : undefined;
    const userId = decryptText(row.userId, row.userId) || row.userId;
    const clientId = row.clientId ? decryptText(row.clientId, row.clientId) : undefined;
    const parentId = row.parentId ? decryptText(row.parentId, row.parentId) : null;
    const order = decryptNumber(row.noteOrder);
    const password = row.password ? decryptText(row.password, row.password) : undefined;

    return {
        _id: row._id,
        title: row.title,
        content: row.content,
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
        __rawEncryptedTitle: row.title,
        __rawEncryptedContent: row.content,
        __rawEncryptedTags: row.tags,
        __rawEncryptedIcon: row.icon,
    };
  });
  return notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const getLocalNoteSyncIndex = async (): Promise<Map<string, string>> => {
  const rows = await db.getAllAsync<any>('SELECT _id, updatedAt FROM notes');
  return new Map(
    rows.map((row) => [
      String(row._id),
      String(decryptText(row.updatedAt, row.updatedAt) || row.updatedAt || '')
    ])
  );
};

export const deleteNoteLocal = async (id: string) => {
  await db.runAsync('DELETE FROM notes WHERE _id = ?', [id]);
};

export const saveTaskLocal = async (task: Task, isSynced: boolean = true) => {
  const encryptedTitle = encrypt(task.title);
  const encryptedDescription = task.description ? encrypt(task.description) : '';
  const encryptedPriority = encrypt(task.priority ?? 'medium');
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
  const encryptedRecurrenceType = task.recurrenceType ? encrypt(task.recurrenceType) : null;
  const encryptedRecurrenceDays = Array.isArray(task.recurrenceDays) ? encrypt(JSON.stringify(task.recurrenceDays)) : null;
  const encryptedReminderEnabled = task.reminderEnabled !== undefined ? encrypt(String(!!task.reminderEnabled)) : null;
  const encryptedReminderOffsetMinutes = Array.isArray(task.reminderOffsetMinutes) ? encrypt(JSON.stringify(task.reminderOffsetMinutes)) : null;
  
  let encryptedDueDate: string | null = null;
  if (task.dueDate) {
      const isoDate = toIsoString(task.dueDate);
      encryptedDueDate = encrypt(isoDate);
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO tasks (_id, title, description, priority, completed, dueDate, createdAt, updatedAt, userId, parentNoteId, parentId, position, recurrenceType, recurrenceDays, reminderEnabled, reminderOffsetMinutes, clientId, isSynced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      encryptedRecurrenceType,
      encryptedRecurrenceDays,
      encryptedReminderEnabled,
      encryptedReminderOffsetMinutes,
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
    const recurrenceType = row.recurrenceType ? decryptText(row.recurrenceType, row.recurrenceType) : 'none';
    const recurrenceDays = (() => {
      if (!row.recurrenceDays) return [];
      const raw = decryptText(row.recurrenceDays, row.recurrenceDays) || '';
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    const reminderEnabled = row.reminderEnabled ? decryptText(row.reminderEnabled, row.reminderEnabled) === 'true' : false;
    const reminderOffsetMinutes = (() => {
      if (!row.reminderOffsetMinutes) return [];
      const raw = decryptText(row.reminderOffsetMinutes, row.reminderOffsetMinutes) || '';
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        const num = Number(raw);
        return Number.isNaN(num) ? [] : [num];
      }
    })();

    return {
        _id: row._id,
        title: decryptDisplayText(row.title, ''),
        description: row.description ? decryptDisplayText(row.description, '') : '',
        priority: priority,
        completed: completed,
        dueDate: dueDate,
        createdAt: createdAt,
        updatedAt: updatedAt,
        userId: userId,
        parentNoteId: parentNoteId,
        clientId: clientId,
        parentId: parentId,
        position: position ?? 0,
        recurrenceType: recurrenceType as any,
        recurrenceDays,
        reminderEnabled,
        reminderOffsetMinutes
    } as unknown as Task;
  });
  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const getLocalTaskSyncIndex = async (): Promise<Map<string, string>> => {
  const rows = await db.getAllAsync<any>('SELECT _id, updatedAt FROM tasks');
  return new Map(
    rows.map((row) => [
      String(row._id),
      String(decryptText(row.updatedAt, row.updatedAt) || row.updatedAt || '')
    ])
  );
};

export const migrateLocalEncryptedData = async () => {
  const noteColumns = ['title', 'content', 'tags', 'createdAt', 'updatedAt', 'userId', 'clientId', 'type', 'parentId', 'noteOrder', 'icon', 'iconColor', 'locked', 'password', 'isSynced'];
  const taskColumns = ['title', 'description', 'priority', 'completed', 'dueDate', 'createdAt', 'updatedAt', 'userId', 'parentNoteId', 'parentId', 'position', 'recurrenceType', 'recurrenceDays', 'reminderEnabled', 'reminderOffsetMinutes', 'clientId', 'isSynced'];
  let migratedNotes = 0;
  let migratedTasks = 0;

  const noteRows = await db.getAllAsync<any>(`SELECT _id, ${noteColumns.join(', ')} FROM notes`);
  for (const row of noteRows) {
    const updates: string[] = [];
    const params: any[] = [];
    for (const column of noteColumns) {
      const next = shouldReencrypt(row[column]);
      if (next && next !== row[column]) {
        updates.push(`${column} = ?`);
        params.push(next);
      }
    }
    if (updates.length > 0) {
      await db.runAsync(`UPDATE notes SET ${updates.join(', ')} WHERE _id = ?`, [...params, row._id]);
      migratedNotes += 1;
    }
  }

  const taskRows = await db.getAllAsync<any>(`SELECT _id, ${taskColumns.join(', ')} FROM tasks`);
  for (const row of taskRows) {
    const updates: string[] = [];
    const params: any[] = [];
    for (const column of taskColumns) {
      const next = shouldReencrypt(row[column]);
      if (next && next !== row[column]) {
        updates.push(`${column} = ?`);
        params.push(next);
      }
    }
    if (updates.length > 0) {
      await db.runAsync(`UPDATE tasks SET ${updates.join(', ')} WHERE _id = ?`, [...params, row._id]);
      migratedTasks += 1;
    }
  }

  return { migratedNotes, migratedTasks };
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
  const encryptedTimestamp = encryptText(new Date().toISOString());
  if (dedupeKeyHash) {
    await db.runAsync(
      `INSERT INTO sync_queue (action, entity, data, timestamp, dedupeKey, dedupeKeyHash)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupeKeyHash) DO UPDATE SET
         action = excluded.action,
         entity = excluded.entity,
         data = excluded.data,
         timestamp = excluded.timestamp,
         dedupeKey = excluded.dedupeKey`,
      [encryptedAction, encryptedEntity, encryptedData, encryptedTimestamp, encryptedDedupeKey, dedupeKeyHash]
    );
    recordSyncQueueEnqueue();
    return;
  }
  await db.runAsync(
    `INSERT INTO sync_queue (action, entity, data, timestamp, dedupeKey, dedupeKeyHash) VALUES (?, ?, ?, ?, ?, ?)`,
    [encryptedAction, encryptedEntity, encryptedData, encryptedTimestamp, encryptedDedupeKey, dedupeKeyHash]
  );
  recordSyncQueueEnqueue();
};

export const mergeIntoQueuedCreate = async (entity: string, tempId: string, patch: Record<string, unknown>) => {
  const dedupeKey = `CREATE:${entity}:tempId:${tempId}`;
  const dedupeKeyHash = hashText(dedupeKey);
  const row = await db.getFirstAsync<any>('SELECT id, data FROM sync_queue WHERE dedupeKeyHash = ?', [dedupeKeyHash]);
  if (!row) return false;

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(decryptText(row.data, row.data) || row.data);
  } catch {
    existing = {};
  }

  const merged = { ...existing, ...patch, tempId };
  await db.runAsync(
    'UPDATE sync_queue SET data = ?, timestamp = ? WHERE id = ?',
    [encrypt(JSON.stringify(merged)), encryptText(new Date().toISOString()), row.id]
  );
  recordSyncQueueMergeIntoCreate();
  return true;
};

export const removeQueuedCreate = async (entity: string, tempId: string) => {
  const dedupeKey = `CREATE:${entity}:tempId:${tempId}`;
  const dedupeKeyHash = hashText(dedupeKey);
  const row = await db.getFirstAsync<any>('SELECT id FROM sync_queue WHERE dedupeKeyHash = ?', [dedupeKeyHash]);
  if (!row?.id) return false;
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
  recordSyncQueueRemoveQueuedCreate();
  return true;
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

export const saveConversationLocal = async (conversation: LocalConversation) => {
  const encryptedTitle = encrypt(conversation.title);
  const encryptedModel = conversation.model ? encrypt(conversation.model) : null;
  const encryptedProjectId = conversation.projectId ? encrypt(conversation.projectId) : null;
  const encryptedIcon = conversation.icon ? encrypt(conversation.icon) : null;
  const encryptedIconColor = conversation.iconColor ? encrypt(conversation.iconColor) : null;
  const encryptedLocalOnly = encrypt(conversation.localOnly ? 'true' : 'false');
  const encryptedCreatedAt = encrypt(conversation.createdAt);
  const encryptedUpdatedAt = encrypt(conversation.updatedAt);

  await db.runAsync(
    `INSERT OR REPLACE INTO conversations (id, title, model, projectId, icon, iconColor, localOnly, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [conversation.id, encryptedTitle, encryptedModel, encryptedProjectId, encryptedIcon, encryptedIconColor, encryptedLocalOnly, encryptedCreatedAt, encryptedUpdatedAt]
  );
};

export const getConversationsLocal = async (): Promise<LocalConversation[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM conversations');
  return result.map((row: any) => ({
    id: row.id,
    title: decrypt(row.title),
    model: row.model ? decrypt(row.model) : undefined,
    projectId: row.projectId ? decrypt(row.projectId) : undefined,
    icon: row.icon ? decrypt(row.icon) : undefined,
    iconColor: row.iconColor ? decrypt(row.iconColor) : undefined,
    localOnly: row.localOnly ? decrypt(row.localOnly) === 'true' : false,
    createdAt: decrypt(row.createdAt),
    updatedAt: decrypt(row.updatedAt),
    messages: []
  })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const deleteConversationLocal = async (id: string) => {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
};

export const saveMessageLocal = async (conversationId: string, message: Message) => {
  const messageId = message.id ?? `local_${Date.now()}`;
  const encryptedRole = encrypt(message.role);
  const encryptedContent = encrypt(message.content);
  const encryptedToolCalls = message.toolCalls ? encrypt(JSON.stringify(message.toolCalls)) : null;
  const encryptedToolCallId = message.toolCallId ? encrypt(message.toolCallId) : null;
  const createdAt = message.createdAt ?? new Date().toISOString();
  const encryptedCreatedAt = encrypt(createdAt);

  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversationId, role, content, toolCalls, toolCallId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [messageId, conversationId, encryptedRole, encryptedContent, encryptedToolCalls, encryptedToolCallId, encryptedCreatedAt]
  );
  await db.runAsync('UPDATE conversations SET updatedAt = ? WHERE id = ?', [encryptedCreatedAt, conversationId]);
};

export const getMessagesLocal = async (conversationId: string): Promise<Message[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM messages WHERE conversationId = ?', [conversationId]);
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
  }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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

// AI Projects

export const saveProjectLocal = async (project: LocalAIProject, userId?: string) => {
  const encryptedName = encrypt(project.name);
  const encryptedPrompt = project.systemPrompt ? encrypt(project.systemPrompt) : null;
  const encryptedIcon = project.icon ? encrypt(project.icon) : null;
  const encryptedIconColor = project.iconColor ? encrypt(project.iconColor) : null;
  const encryptedLocalOnly = encrypt(project.localOnly ? 'true' : 'false');
  const encryptedCreatedAt = encrypt(project.createdAt);
  const encryptedUpdatedAt = encrypt(project.updatedAt);
  const encryptedUserId = userId ? encryptText(userId) : null;
  await db.runAsync(
    `INSERT OR REPLACE INTO ai_projects (id, userId, name, systemPrompt, icon, iconColor, localOnly, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, encryptedUserId, encryptedName, encryptedPrompt, encryptedIcon, encryptedIconColor, encryptedLocalOnly, encryptedCreatedAt, encryptedUpdatedAt]
  );
};

export const getProjectsLocal = async (userId?: string): Promise<LocalAIProject[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM ai_projects');
  return result
    .map((row: any) => ({
      id: row.id,
      userId: row.userId ? decryptText(row.userId, row.userId) || row.userId : undefined,
      name: decrypt(row.name),
      systemPrompt: row.systemPrompt ? decrypt(row.systemPrompt) : undefined,
      icon: row.icon ? decrypt(row.icon) : undefined,
      iconColor: row.iconColor ? decrypt(row.iconColor) : undefined,
      localOnly: row.localOnly ? decrypt(row.localOnly) === 'true' : false,
      createdAt: decrypt(row.createdAt),
      updatedAt: decrypt(row.updatedAt),
    }))
    .filter((project) => !userId || project.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const deleteProjectLocal = async (id: string) => {
  await db.runAsync('DELETE FROM ai_projects WHERE id = ?', [id]);
  await db.runAsync('UPDATE conversations SET projectId = NULL WHERE projectId = ?', [encrypt(id)]);
};

export const clearNotesLocal = async () => {
  await db.runAsync('DELETE FROM notes');
};

export const clearTasksLocal = async () => {
  await db.runAsync('DELETE FROM tasks');
};

export const clearModelsLocal = async () => {
  await db.runAsync('DELETE FROM models');
};

export const clearProjectsLocal = async () => {
  await db.runAsync('DELETE FROM ai_projects');
};

export const clearSyncQueue = async () => {
  await db.runAsync('DELETE FROM sync_queue');
};

export const clearLocalData = async () => {
  await db.execAsync(`
    DELETE FROM notes;
    DELETE FROM tasks;
    DELETE FROM sync_queue;
    DELETE FROM conversations;
    DELETE FROM messages;
    DELETE FROM models;
    DELETE FROM ai_projects;
  `);
};
