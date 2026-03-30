import { decrypt, encrypt, setEncryptionKey } from '@repo/shared';

describe('mobile database at-rest encryption', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('stores note title/content encrypted in sqlite writes', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      database = require('../services/database');
    });
    await database.saveNoteLocal({
      _id: 'n1',
      userId: 'u1',
      title: 'Anteckning hemlig titel',
      content: 'Anteckning hemligt innehåll',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      type: 'note',
      parentId: null,
      locked: false,
    } as any, true);

    const noteCalls = (runAsync.mock.calls as unknown as any[][]);
    const insertCall = noteCalls.find((call) => String(call?.[0] || '').includes('INSERT OR REPLACE INTO notes'));
    expect(insertCall).toBeTruthy();
    const params = (insertCall?.[1] || []) as any[];
    expect(params[1]).not.toContain('Anteckning hemlig titel');
    expect(params[2]).not.toContain('Anteckning hemligt innehåll');
    expect(decrypt(params[1])).toBe('Anteckning hemlig titel');
    expect(decrypt(params[2])).toBe('Anteckning hemligt innehåll');
  });

  it('stores task title/description encrypted in sqlite writes', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      database = require('../services/database');
    });
    await database.saveTaskLocal({
      _id: 't1',
      userId: 'u1',
      title: 'Uppgift hemlig titel',
      description: 'Uppgift hemlig beskrivning',
      completed: false,
      priority: 'medium',
      dueDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentNoteId: null,
      parentId: null,
      position: 0,
      recurrenceType: 'none',
      recurrenceDays: [],
      reminderEnabled: true,
      reminderOffsetMinutes: [0],
    } as any, true);

    const taskCalls = (runAsync.mock.calls as unknown as any[][]);
    const insertCall = taskCalls.find((call) => String(call?.[0] || '').includes('INSERT OR REPLACE INTO tasks'));
    expect(insertCall).toBeTruthy();
    const params = (insertCall?.[1] || []) as any[];
    expect(params[1]).not.toContain('Uppgift hemlig titel');
    expect(params[2]).not.toContain('Uppgift hemlig beskrivning');
    expect(decrypt(params[1])).toBe('Uppgift hemlig titel');
    expect(decrypt(params[2])).toBe('Uppgift hemlig beskrivning');
  });

  it('migrates legacy encrypted rows to active key', async () => {
    let legacyNoteTitle = '';

    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    const getAllAsync = jest.fn(async (sql: string) => {
      if (sql.includes('FROM notes')) {
        return [{ _id: 'n1', title: legacyNoteTitle }];
      }
      if (sql.includes('FROM tasks')) {
        return [{ _id: 't1', title: 'Legacy uppgift' }];
      }
      return [];
    });

    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync,
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      const shared = require('@repo/shared');
      shared.setEncryptionKey('noter-default-key');
      legacyNoteTitle = shared.encrypt('Legacy anteckning');
      shared.setEncryptionKey('a'.repeat(64));
      database = require('../services/database');
    });

    const result = await database.migrateLocalEncryptedData();
    expect(result.migratedNotes).toBe(1);
    expect(result.migratedTasks).toBe(1);
    const noteUpdate = runAsync.mock.calls.find((call: any[]) => String(call?.[0] || '').includes('UPDATE notes SET'));
    const taskUpdate = runAsync.mock.calls.find((call: any[]) => String(call?.[0] || '').includes('UPDATE tasks SET'));
    expect(noteUpdate).toBeTruthy();
    expect(taskUpdate).toBeTruthy();
    if (!noteUpdate || !taskUpdate) throw new Error('Migration update calls missing');
    const noteParams = (noteUpdate as any)[1] as any[];
    const taskParams = (taskUpdate as any)[1] as any[];
    expect(String(noteParams[0])).toContain('U2FsdGVkX1');
    expect(String(taskParams[0])).toContain('U2FsdGVkX1');
  });

  it('stores sync queue payloads encrypted to resist local sabotage', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      database = require('../services/database');
    });

    const payload = {
      id: 'note-1',
      content: 'lokalt sabotageförsök',
      parentId: 'project-1',
    };
    await database.addToSyncQueue('UPDATE', 'notes', payload);

    const queueCall = (runAsync.mock.calls as unknown as any[][]).find((call) =>
      String(call?.[0] || '').includes('INSERT INTO sync_queue')
    );
    expect(queueCall).toBeTruthy();
    const params = (queueCall?.[1] || []) as any[];
    expect(params[0]).not.toBe('UPDATE');
    expect(params[1]).not.toBe('notes');
    expect(params[2]).not.toContain('lokalt sabotageförsök');
    expect(JSON.parse(decrypt(params[2]))).toEqual(payload);
    expect(params[4]).not.toBe('UPDATE:notes:id:note-1');
    expect(params[5]).toHaveLength(64);
  });

  it('replaces older queued updates with latest encrypted payload for same entity', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      database = require('../services/database');
    });

    await database.addToSyncQueue('UPDATE', 'TASK', { id: 'task-1', title: 'första' });
    await database.addToSyncQueue('UPDATE', 'TASK', { id: 'task-1', title: 'andra' });

    const queueCalls = (runAsync.mock.calls as unknown as any[][]).filter((call) =>
      String(call?.[0] || '').includes('ON CONFLICT(dedupeKeyHash)')
    );
    expect(queueCalls).toHaveLength(2);
    const firstHash = queueCalls[0]?.[1]?.[5];
    const secondHash = queueCalls[1]?.[1]?.[5];
    expect(firstHash).toBe(secondHash);
    expect(queueCalls[1]?.[1]?.[2]).not.toContain('andra');
    expect(JSON.parse(decrypt(queueCalls[1]?.[1]?.[2]))).toEqual({ id: 'task-1', title: 'andra' });
  });

  it('uses one dedupe identity for reorders of the same item set', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync,
        runAsync,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
      }),
    }));

    let database: any;
    jest.isolateModules(() => {
      database = require('../services/database');
    });

    await database.addToSyncQueue('REORDER', 'TASK', { tasks: [{ _id: 'b' }, { _id: 'a' }] });
    await database.addToSyncQueue('REORDER', 'TASK', { tasks: [{ _id: 'a' }, { _id: 'b' }] });

    const queueCalls = (runAsync.mock.calls as unknown as any[][]).filter((call) =>
      String(call?.[0] || '').includes('ON CONFLICT(dedupeKeyHash)')
    );
    expect(queueCalls).toHaveLength(2);
    expect(queueCalls[0]?.[1]?.[5]).toBe(queueCalls[1]?.[1]?.[5]);
  });
});
