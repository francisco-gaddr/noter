import { decrypt } from '@repo/shared';

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
});
