import { decrypt, encrypt, setActiveDataKey } from '@repo/shared';

const makeDb = () => {
  const runAsync = jest.fn(async () => {});
  const execAsync = jest.fn(async () => {});
  jest.doMock('expo-sqlite', () => ({
    openDatabaseSync: () => ({
      execAsync,
      runAsync,
      getAllAsync: jest.fn(async () => []),
      getFirstAsync: jest.fn(async () => null),
      withTransactionAsync: jest.fn(async (cb: any) => cb()),
    }),
  }));
  let database: any;
  jest.isolateModules(() => { database = require('../services/database'); });
  return { database, runAsync };
};

describe('mobile database at-rest encryption', () => {
  beforeEach(() => {
    jest.resetModules();
    setActiveDataKey(null);
  });
  afterEach(() => setActiveDataKey(null));

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

  it('leaks NO plaintext anywhere in a note INSERT (every param)', async () => {
    const { database, runAsync } = makeDb();
    const SECRETS = ['Topphemlig titel', 'Topphemligt innehåll', 'hemlig-tagg'];
    await database.saveNoteLocal({
      _id: 'n2', userId: 'u1', title: SECRETS[0], content: SECRETS[1], tags: [SECRETS[2]],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      type: 'note', parentId: null, locked: false,
    } as any, true);
    const insert = (runAsync.mock.calls as any[][]).find((c) => String(c?.[0] || '').includes('INSERT OR REPLACE INTO notes'));
    const params = (insert?.[1] || []) as any[];
    for (const p of params) {
      if (typeof p !== 'string') continue;
      for (const secret of SECRETS) expect(p).not.toContain(secret);
    }
  });

  it('encrypts the offline sync_queue payload (action/entity/data)', async () => {
    const { database, runAsync } = makeDb();
    await database.addToSyncQueue('CREATE', 'NOTE', { title: 'Köhemlighet', id: 'x1' });
    const insert = (runAsync.mock.calls as any[][]).find((c) => String(c?.[0] || '').includes('INTO sync_queue'));
    expect(insert).toBeTruthy();
    const params = (insert?.[1] || []) as any[];
    const joined = params.filter((p) => typeof p === 'string').join('|');
    expect(joined).not.toContain('Köhemlighet');
    expect(joined).not.toContain('CREATE');
    expect(joined).not.toContain('NOTE');
  });

  it('read path never blanks plaintext/legacy conversation + message rows', async () => {
    const convRow = { id: 'c1', title: 'Plain Title', model: encrypt('gpt'), createdAt: 'plain-date', updatedAt: encrypt('2026'), localOnly: encrypt('false') };
    const msgRow = { id: 'm1', conversationId: 'c1', role: 'user', content: 'Plain message', createdAt: encrypt('2026') };
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync: jest.fn(async () => {}),
        runAsync: jest.fn(async () => {}),
        getAllAsync: jest.fn(async (sql: string) =>
          sql.includes('conversations') ? [convRow] : sql.includes('messages') ? [msgRow] : []),
        getFirstAsync: jest.fn(async () => null),
        withTransactionAsync: jest.fn(async (cb: any) => cb()),
      }),
    }));
    let database: any;
    jest.isolateModules(() => { database = require('../services/database'); });

    const convs = await database.getConversationsLocal();
    expect(convs[0].title).toBe('Plain Title'); // plaintext passes through (not blanked)
    expect(convs[0].model).toBe('gpt'); // legacy ciphertext decrypts

    const msgs = await database.getMessagesLocal('c1');
    expect(msgs[0].content).toBe('Plain message'); // not blanked
    expect(msgs[0].role).toBe('user');
  });

  // Note: the v3-active write path is proven in packages/shared/src/encrypt.test.ts
  // (dispatch tests). It can't be asserted here because jest.isolateModules gives
  // database.ts a separate @repo/shared instance, so the active-key provider state
  // set in this file doesn't reach it.
});
