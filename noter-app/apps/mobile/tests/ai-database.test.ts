import { clearEncryptionKey, decrypt, decryptV3, encrypt, encryptV3, setEncryptionKey } from '@repo/shared';

describe('mobile AI database', () => {
  beforeEach(() => {
    jest.resetModules();
    setEncryptionKey('a'.repeat(64));
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  const loadDatabaseWithKey = () => {
    let database: any;
    jest.isolateModules(() => {
      const shared = require('@repo/shared');
      shared.setEncryptionKey('a'.repeat(64));
      database = require('../services/database');
    });
    return database;
  };

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

    const database = loadDatabaseWithKey();

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

    const database = loadDatabaseWithKey();

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
    await expect(decryptV3((clearProjectCall as any)[1][1])).resolves.toBe('project-1');
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

    const database = loadDatabaseWithKey();

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
    expect(params[2]).toMatch(/^noter:v3:/);
    expect(params[3]).toMatch(/^noter:v3:/);
    expect(params[4]).toMatch(/^noter:v3:/);
    expect(params[5]).toMatch(/^noter:v3:/);
    expect(params[3]).not.toContain('Här är svaret');
  });

  it('reads v3-encrypted conversations and projects from local AI storage', async () => {
    const runAsync = jest.fn(async () => {});
    const execAsync = jest.fn(async () => {});
    const getAllAsync = jest.fn(async (sql: string) => {
      if (sql.includes('FROM conversations')) {
        return [
          {
            id: 'c-v3',
            title: await encryptV3('V3 konversation'),
            model: await encryptV3('gpt-4.1'),
            projectId: await encryptV3('p-v3'),
            localOnly: await encryptV3('false'),
            createdAt: await encryptV3('2026-03-29T10:00:00.000Z'),
            updatedAt: await encryptV3('2026-03-29T11:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('FROM ai_projects')) {
        return [
          {
            id: 'p-v3',
            userId: await encryptV3('scope-1'),
            name: await encryptV3('Projekt V3'),
            systemPrompt: await encryptV3('Hemlig prompt'),
            icon: await encryptV3('FaFolder'),
            iconColor: await encryptV3('#123456'),
            localOnly: await encryptV3('true'),
            createdAt: await encryptV3('2026-03-29T09:00:00.000Z'),
            updatedAt: await encryptV3('2026-03-29T11:30:00.000Z'),
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

    const database = loadDatabaseWithKey();

    const [conversations, projects] = await Promise.all([
      database.getConversationsLocal(),
      database.getProjectsLocal('scope-1'),
    ]);

    expect(conversations).toEqual([
      expect.objectContaining({
        id: 'c-v3',
        title: 'V3 konversation',
        model: 'gpt-4.1',
        projectId: 'p-v3',
      }),
    ]);
    expect(projects).toEqual([
      expect.objectContaining({
        id: 'p-v3',
        userId: 'scope-1',
        name: 'Projekt V3',
        systemPrompt: 'Hemlig prompt',
        localOnly: true,
      }),
    ]);
  });
});
