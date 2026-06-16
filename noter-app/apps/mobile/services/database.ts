import * as SQLite from 'expo-sqlite';
import CryptoJS from 'crypto-js';
import { Note, Task, Conversation, Message, AIModel, AIProject, encrypt, decrypt, safeDecrypt, serializeEntityLinks } from '@repo/shared';

type LocalConversation = Conversation & { localOnly?: boolean };
type LocalAIProject = AIProject & { localOnly?: boolean };

const db = SQLite.openDatabaseSync('noter.db');

// ---------------------------------------------------------------------------
// Write serialization — the real fix for intermittent "database is locked".
//
// expo-sqlite shares one WAL connection. WAL allows many concurrent readers but
// only ONE writer; a multi-statement `withTransactionAsync` is NOT exclusive, so
// a concurrent write (a chat-message save, the sync queue, an offline flush) can
// interleave between its BEGIN and COMMIT and SQLite returns SQLITE_BUSY /
// "database is locked" even with busy_timeout set (the timeout doesn't apply when
// a deferred read-txn is upgraded to a write). Fix per Expo docs (June 2026):
//   1. WAL + busy_timeout (set in initDatabase).
//   2. Use withExclusiveTransactionAsync for multi-statement transactions (BEGIN
//      EXCLUSIVE respects busy_timeout; the non-exclusive variant does not).
//   3. Route every runtime write through `run`/`exec`/`dbExclusiveTransaction`,
//      which retry transient SQLITE_BUSY/locked with backoff so a brief contention
//      window never surfaces to the user as a failed chat send.
const isLockedError = (e: unknown): boolean =>
  /lock|busy|SQLITE_BUSY/i.test(String((e as { message?: string })?.message ?? e));

/**
 * Run a write, retrying transient SQLITE_BUSY / "database is locked" with backoff.
 * Composable/nestable (pure try-retry, no queue) so it is safe to use both on a
 * single auto-commit statement AND on a whole exclusive transaction — and an
 * inner write inside a transaction simply never hits BUSY (the txn holds the
 * lock), so it runs once. This is the documented Expo fix together with WAL +
 * busy_timeout + withExclusiveTransactionAsync.
 */
export const withBusyRetry = async <T>(fn: () => Promise<T>, attempts = 6): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isLockedError(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 40 * (i + 1))); // 40,80,…,240ms backoff
    }
  }
  throw lastErr;
};

/** Exclusive multi-statement transaction (no interleaving writes), retried on BUSY. */
const dbExclusiveTransaction = (body: () => Promise<void>): Promise<void> =>
  withBusyRetry(() => db.withExclusiveTransactionAsync(body));

// Single-statement write helpers — use instead of db.runAsync / db.execAsync for
// RUNTIME writes so a transient lock is retried instead of surfacing to the user.
// Safe to call inside a dbExclusiveTransaction body too (the txn holds the lock,
// so the inner statement runs once without retrying).
const run = (sql: string, params?: SQLite.SQLiteBindValue[]): Promise<SQLite.SQLiteRunResult> =>
  withBusyRetry(() => db.runAsync(sql, params ?? []));
const exec = (sql: string): Promise<void> => withBusyRetry(() => db.execAsync(sql));

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
};

const decryptText = (value: unknown, fallback: string | null = null): string | null => {
  if (value == null) return fallback;
  const raw = typeof value === 'string' ? value : String(value);
  // safeDecrypt: passes plaintext/legacy values through, decrypts real
  // ciphertext, and returns `raw` (never '') if a ciphertext fails to decrypt.
  return safeDecrypt(raw, raw);
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
    PRAGMA busy_timeout = 8000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
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
      dedupeKeyHash TEXT,
      attempts INTEGER DEFAULT 0
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

  // Provenance for externally-synced notes (Nextcloud `source`) + explicit links. Without these,
  // offline save dropped them → synced notes lost their `source` on reload (duplicate folders,
  // info showed "local", hidden-file filter + outbound push stopped working).
  try { await db.execAsync('ALTER TABLE notes ADD COLUMN source TEXT'); } catch (e) { /* exists */ }
  try { await db.execAsync('ALTER TABLE notes ADD COLUMN links TEXT'); } catch (e) { /* exists */ }

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
      await db.execAsync('ALTER TABLE sync_queue ADD COLUMN attempts INTEGER DEFAULT 0');
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
        await run('DELETE FROM sync_queue WHERE id = ?', [row.id]);
        continue;
      }
      seen.add(hash);
    }

    await run(
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

  // Provenance + explicit links must survive offline save, otherwise a synced note loses
  // its `source` on reload — which broke folder dedup, the info view, the hidden-file
  // filter and the outbound Nextcloud push (they all key off note.source).
  const rawSource = (note as any).__rawEncryptedSource;
  const encryptedSource = typeof rawSource === 'string' && rawSource
    ? rawSource
    : ((note as any).source ? encrypt(JSON.stringify((note as any).source)) : null);
  const rawLinks = (note as any).__rawEncryptedLinks;
  const encryptedLinks = typeof rawLinks === 'string' && rawLinks
    ? rawLinks
    : (((note as any).links && (note as any).links.length)
        ? encrypt(serializeEntityLinks((note as any).links))
        : null);

  await run(
    `INSERT OR REPLACE INTO notes (_id, title, content, tags, createdAt, updatedAt, userId, clientId, type, parentId, noteOrder, icon, iconColor, locked, password, isSynced, source, links)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      encryptedIsSynced,
      encryptedSource,
      encryptedLinks
    ]
  );
};

/**
 * Persist many notes in a single transaction (one commit/fsync instead of N).
 * Used by the offline-first refresh path so writing the server snapshot to disk
 * doesn't block the UI with a sequential await-per-row loop.
 */
export const saveNotesLocalBulk = async (notes: Note[], isSynced: boolean = true): Promise<void> => {
  if (!notes.length) return;
  await dbExclusiveTransaction(async () => {
    for (const note of notes) await saveNoteLocal(note, isSynced);
  });
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
        const decryptedType = safeDecrypt(row.type, row.type);
        if (['note', 'task_list', 'project'].includes(decryptedType)) {
            type = decryptedType as any;
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
        // Hand the still-encrypted provenance/links straight back; materializeOneNote
        // decrypts them (parseNoteSource / parseEntityLinks) like the server payload.
        source: row.source || undefined,
        links: row.links || undefined,
        __rawEncryptedTitle: row.title,
        __rawEncryptedContent: row.content,
        __rawEncryptedTags: row.tags,
        __rawEncryptedIcon: row.icon,
        __rawEncryptedSource: row.source,
        __rawEncryptedLinks: row.links,
    };
  });
  return notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const deleteNoteLocal = async (id: string) => {
  await run('DELETE FROM notes WHERE _id = ?', [id]);
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

  await run(
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

/** Persist many tasks in a single transaction (see saveNotesLocalBulk). */
export const saveTasksLocalBulk = async (tasks: Task[], isSynced: boolean = true): Promise<void> => {
  if (!tasks.length) return;
  await dbExclusiveTransaction(async () => {
    for (const task of tasks) await saveTaskLocal(task, isSynced);
  });
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
        title: safeDecrypt(row.title, row.title),
        description: row.description ? safeDecrypt(row.description, row.description) : '',
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

export const deleteTaskLocal = async (id: string) => {
  await run('DELETE FROM tasks WHERE _id = ?', [id]);
};

/**
 * Enqueue an offline mutation for later replay by `syncOfflineChanges`.
 *
 * Dedupe + latest-wins: keyed items (UPDATE/DELETE/keyed-CREATE — see
 * `computeSyncDedupeKey`) collapse on their `dedupeKeyHash` via an UPSERT.
 * The payload here is the FULL entity state, so when the user edits the same
 * note/task twice while offline the *latest* payload must replace the queued
 * one — otherwise the stale first edit is what reaches the server and the
 * post-sync `fetchNotes`/`fetchTasks` overwrites the newer local copy, silently
 * losing the second edit. `INSERT OR IGNORE` had exactly that bug; the
 * `ON CONFLICT … DO UPDATE` below makes latest-wins explicit and resets the
 * retry counter because a fresh edit is a fresh intent.
 *
 * Keyless items (REORDER, and CREATEs without tempId/clientId) get a null
 * `dedupeKeyHash`; SQLite treats nulls as distinct in a UNIQUE index, so they
 * never collide and are always appended.
 */
export const addToSyncQueue = async (action: string, entity: string, data: any) => {
  const dedupeKey = computeSyncDedupeKey(action, entity, data);
  const encryptedData = encrypt(JSON.stringify(data));
  const encryptedAction = encryptText(action);
  const encryptedEntity = encryptText(entity);
  const encryptedDedupeKey = dedupeKey ? encryptText(dedupeKey) : null;
  const dedupeKeyHash = dedupeKey ? hashText(dedupeKey) : null;
  await run(
    `INSERT INTO sync_queue (action, entity, data, timestamp, dedupeKey, dedupeKeyHash)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupeKeyHash) DO UPDATE SET
       action = excluded.action,
       entity = excluded.entity,
       data = excluded.data,
       timestamp = excluded.timestamp,
       dedupeKey = excluded.dedupeKey,
       attempts = 0`,
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
    return { id: row.id, action, entity, data, timestamp, attempts: Number(row.attempts) || 0 };
  });
  return queue.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

export const removeFromSyncQueue = async (id: number) => {
  await run('DELETE FROM sync_queue WHERE id = ?', [id]);
};

/** Bump the retry counter for a queue item that failed transiently. Returns the new count. */
export const incrementSyncAttempt = async (id: number): Promise<number> => {
  await run('UPDATE sync_queue SET attempts = COALESCE(attempts, 0) + 1 WHERE id = ?', [id]);
  const row = await db.getFirstAsync<any>('SELECT attempts FROM sync_queue WHERE id = ?', [id]);
  return Number(row?.attempts) || 0;
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

  await run(
    `INSERT OR REPLACE INTO conversations (id, title, model, projectId, icon, iconColor, localOnly, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [conversation.id, encryptedTitle, encryptedModel, encryptedProjectId, encryptedIcon, encryptedIconColor, encryptedLocalOnly, encryptedCreatedAt, encryptedUpdatedAt]
  );
};

export const getConversationsLocal = async (): Promise<LocalConversation[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM conversations ORDER BY updatedAt DESC');
  return result.map((row: any) => ({
    id: row.id,
    title: safeDecrypt(row.title, row.title),
    model: row.model ? safeDecrypt(row.model, row.model) : undefined,
    projectId: row.projectId ? safeDecrypt(row.projectId, row.projectId) : undefined,
    icon: row.icon ? safeDecrypt(row.icon, row.icon) : undefined,
    iconColor: row.iconColor ? safeDecrypt(row.iconColor, row.iconColor) : undefined,
    localOnly: row.localOnly ? safeDecrypt(row.localOnly) === 'true' : false,
    createdAt: safeDecrypt(row.createdAt, row.createdAt),
    updatedAt: safeDecrypt(row.updatedAt, row.updatedAt),
    messages: []
  }));
};

export const deleteConversationLocal = async (id: string) => {
  await run('DELETE FROM conversations WHERE id = ?', [id]);
};

export const saveMessageLocal = async (conversationId: string, message: Message) => {
  const messageId = message.id ?? `local_${Date.now()}`;
  const encryptedRole = encrypt(message.role);
  const encryptedContent = encrypt(message.content);
  const encryptedToolCalls = message.toolCalls ? encrypt(JSON.stringify(message.toolCalls)) : null;
  const encryptedToolCallId = message.toolCallId ? encrypt(message.toolCallId) : null;
  const encryptedCreatedAt = encrypt(message.createdAt ?? new Date().toISOString());

  await run(
    `INSERT OR REPLACE INTO messages (id, conversationId, role, content, toolCalls, toolCallId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [messageId, conversationId, encryptedRole, encryptedContent, encryptedToolCalls, encryptedToolCallId, encryptedCreatedAt]
  );
};

export const getMessagesLocal = async (conversationId: string): Promise<Message[]> => {
  // createdAt is stored ENCRYPTED, so `ORDER BY createdAt` would sort by ciphertext
  // (random per the AES-GCM IV) — that's why message order flipped. Use rowid (insertion
  // order) as the reliable base, then stable-sort by the DECRYPTED timestamp below.
  const result = await db.getAllAsync<any>('SELECT * FROM messages WHERE conversationId = ? ORDER BY rowid ASC', [conversationId]);
  const mapped = result.map((row: any) => {
    let toolCalls = undefined;
    if (row.toolCalls) {
      try {
        toolCalls = JSON.parse(safeDecrypt(row.toolCalls, row.toolCalls));
      } catch {}
    }
    return {
      id: row.id,
      role: safeDecrypt(row.role, row.role) as any,
      content: safeDecrypt(row.content, row.content),
      toolCalls,
      toolCallId: row.toolCallId ? safeDecrypt(row.toolCallId, row.toolCallId) : undefined,
      createdAt: safeDecrypt(row.createdAt, row.createdAt)
    };
  });
  // Stable sort (Array.sort is stable) by real timestamp; equal/invalid timestamps keep
  // insertion (rowid) order, so the newest message is always last (bottom of the chat).
  return mapped
    .map((m, i) => ({ m, i, t: Date.parse(m.createdAt) }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? a.i : a.t;
      const bt = Number.isNaN(b.t) ? b.i : b.t;
      return at - bt || a.i - b.i;
    })
    .map((x) => x.m);
};

// AI Models

export const saveModelLocal = async (model: AIModel) => {
  const encryptedName = encrypt(model.name);
  const encryptedFilename = encrypt(model.filename);
  const encryptedPath = encrypt(model.path);
  const encryptedQuantization = model.quantization ? encrypt(model.quantization) : null;
  const encryptedSize = encrypt(String(model.size));
  const encryptedDownloaded = encrypt(String(model.downloaded));

  await run(
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
  await run('DELETE FROM models WHERE id = ?', [id]);
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
  await run(
    `INSERT OR REPLACE INTO ai_projects (id, userId, name, systemPrompt, icon, iconColor, localOnly, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, encryptedUserId, encryptedName, encryptedPrompt, encryptedIcon, encryptedIconColor, encryptedLocalOnly, encryptedCreatedAt, encryptedUpdatedAt]
  );
};

export const getProjectsLocal = async (userId?: string): Promise<LocalAIProject[]> => {
  const result = await db.getAllAsync<any>('SELECT * FROM ai_projects ORDER BY updatedAt DESC');
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
    .filter((project) => !userId || project.userId === userId);
};

export const deleteProjectLocal = async (id: string) => {
  await run('DELETE FROM ai_projects WHERE id = ?', [id]);
  await run('UPDATE conversations SET projectId = NULL WHERE projectId = ?', [id]);
};

export const clearNotesLocal = async () => {
  await run('DELETE FROM notes');
};

export const clearTasksLocal = async () => {
  await run('DELETE FROM tasks');
};

export const clearModelsLocal = async () => {
  await run('DELETE FROM models');
};

export const clearProjectsLocal = async () => {
  await run('DELETE FROM ai_projects');
};

export const clearSyncQueue = async () => {
  await run('DELETE FROM sync_queue');
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
