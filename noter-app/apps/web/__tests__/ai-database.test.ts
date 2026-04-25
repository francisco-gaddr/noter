const mockDb = {
  put: jest.fn(),
  getAllFromIndex: jest.fn(),
  clear: jest.fn(),
};

jest.mock('idb', () => ({
  openDB: jest.fn(async () => mockDb),
}));

describe('web ai database', () => {
  beforeEach(() => {
    jest.resetModules();
    mockDb.put.mockReset();
    mockDb.getAllFromIndex.mockReset();
    mockDb.clear.mockReset();
  });

  it('stores local ai conversations and messages with v3 ciphertext', async () => {
    const shared = await import('@repo/shared');
    shared.setEncryptionKey('a'.repeat(64));
    const { db } = await import('../services/db');

    await db.saveConversation({
      id: 'c1',
      title: 'Hemlig konversation',
      model: 'gpt-4.1',
      projectId: 'p1',
      icon: 'FaComments',
      iconColor: '#123456',
      localOnly: false,
      userId: 'user-1',
      createdAt: '2026-03-29T10:00:00.000Z',
      updatedAt: '2026-03-29T11:00:00.000Z',
      messages: [],
    } as any);
    await db.saveMessage('c1', {
      id: 'm1',
      role: 'assistant',
      content: 'Här är svaret',
      toolCalls: [{ tool: 'list_tasks', arguments: { completed: false } }],
      toolCallId: 'tool-1',
      createdAt: '2026-03-29T11:05:00.000Z',
    } as any);

    const conversationInsert = mockDb.put.mock.calls.find((call) => call[0] === 'conversations');
    const messageInsert = mockDb.put.mock.calls.find((call) => call[0] === 'messages');

    expect(conversationInsert?.[1]?.title).toMatch(/^noter:v3:/);
    expect(conversationInsert?.[1]?.projectId).toMatch(/^noter:v3:/);
    expect(messageInsert?.[1]?.content).toMatch(/^noter:v3:/);
    expect(messageInsert?.[1]?.toolCalls).toMatch(/^noter:v3:/);
    expect(conversationInsert?.[1]?.title).not.toContain('Hemlig konversation');
    expect(messageInsert?.[1]?.content).not.toContain('Här är svaret');

    shared.clearEncryptionKey();
  });

  it('reads legacy and v3 ai records from local storage', async () => {
    const shared = await import('@repo/shared');
    shared.setEncryptionKey('a'.repeat(64));
    const { db } = await import('../services/db');

    mockDb.getAllFromIndex.mockImplementation(async (storeName: string) => {
      if (storeName === 'conversations') {
        return [
          {
            id: 'c-legacy',
            title: shared.encrypt('Legacy konversation'),
            localOnly: shared.encrypt('false'),
            createdAt: shared.encrypt('2026-03-29T09:00:00.000Z'),
            updatedAt: shared.encrypt('2026-03-29T09:00:00.000Z'),
          },
          {
            id: 'c-v3',
            title: await shared.encryptV3('V3 konversation'),
            model: await shared.encryptV3('gpt-4.1'),
            projectId: await shared.encryptV3('p-v3'),
            localOnly: await shared.encryptV3('true'),
            createdAt: await shared.encryptV3('2026-03-29T10:00:00.000Z'),
            updatedAt: await shared.encryptV3('2026-03-29T11:00:00.000Z'),
          },
        ];
      }
      if (storeName === 'messages') {
        return [
          {
            id: 'm1',
            role: await shared.encryptV3('assistant'),
            content: await shared.encryptV3('Svar V3'),
            toolCalls: await shared.encryptV3(JSON.stringify([{ tool: 'list_tasks' }])),
            createdAt: await shared.encryptV3('2026-03-29T11:05:00.000Z'),
          },
        ];
      }
      return [];
    });

    const [conversations, messages] = await Promise.all([
      db.getConversations(),
      db.getMessages('c-v3'),
    ]);

    expect(conversations.map((item: any) => item.id)).toEqual(['c-v3', 'c-legacy']);
    expect(conversations[0]).toEqual(expect.objectContaining({
      title: 'V3 konversation',
      model: 'gpt-4.1',
      projectId: 'p-v3',
      localOnly: true,
    }));
    expect(conversations[1]).toEqual(expect.objectContaining({
      title: 'Legacy konversation',
      localOnly: false,
    }));
    expect(messages[0]).toEqual(expect.objectContaining({
      role: 'assistant',
      content: 'Svar V3',
      toolCalls: [{ tool: 'list_tasks' }],
    }));

    shared.clearEncryptionKey();
  });
});
