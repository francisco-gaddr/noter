import { decrypt, encrypt } from '@repo/shared';

describe('mobile AI database', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('sorts conversations by decrypted updatedAt', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    const getAllAsync = jest.fn(async (sql: string) => {
      if (sql.includes('FROM conversations')) {
        return [
          {
            id: 'c1',
            title: encrypt('Äldre'),
            localOnly: encrypt('false'),
            createdAt: encrypt('2026-03-29T10:00:00.000Z'),
            updatedAt: encrypt('2026-03-29T10:00:00.000Z'),
          },
          {
            id: 'c2',
            title: encrypt('Nyare'),
            localOnly: encrypt('false'),
            createdAt: encrypt('2026-03-29T11:00:00.000Z'),
            updatedAt: encrypt('2026-03-29T11:00:00.000Z'),
          },
        ];
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
      database = require('../services/database');
    });

    const conversations = await database.getConversationsLocal();
    expect(conversations.map((item: any) => item.id)).toEqual(['c2', 'c1']);
  });

  it('updates conversation timestamp when saving messages and clears encrypted projectId on delete', async () => {
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

    await database.saveMessageLocal('conv-1', {
      id: 'm1',
      role: 'user',
      content: 'Hej',
      createdAt: '2026-03-29T12:00:00.000Z',
    });
    await database.deleteProjectLocal('project-1');

    const updateConversationCall = runAsync.mock.calls.find((call: any[]) =>
      String(call?.[0] || '').includes('UPDATE conversations SET updatedAt = ?')
    );
    const clearProjectCall = runAsync.mock.calls.find((call: any[]) =>
      String(call?.[0] || '').includes('UPDATE conversations SET projectId = NULL')
    );

    expect(updateConversationCall).toBeTruthy();
    expect(clearProjectCall).toBeTruthy();
    expect(decrypt((clearProjectCall as any)[1][0])).toBe('project-1');
  });

  it('stores assistant replies and tool history encrypted in local AI messages', async () => {
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

    await database.saveMessageLocal('conv-2', {
      id: 'm2',
      role: 'assistant',
      content: 'Här är svaret',
      toolCalls: [{ tool: 'list_tasks', arguments: { completed: false } }],
      toolCallId: 'tool-1',
      createdAt: '2026-03-29T12:30:00.000Z',
    });

    const insertCall = runAsync.mock.calls.find((call: any[]) =>
      String(call?.[0] || '').includes('INSERT OR REPLACE INTO messages')
    ) as [string, any[]] | undefined;

    expect(insertCall).toBeTruthy();
    const params = insertCall?.[1] || [];
    expect(params[2]).toMatch(/^U2FsdGVkX1/);
    expect(params[3]).toMatch(/^U2FsdGVkX1/);
    expect(params[4]).toMatch(/^U2FsdGVkX1/);
    expect(params[5]).toMatch(/^U2FsdGVkX1/);
    expect(params[3]).not.toContain('Här är svaret');
  });
});
