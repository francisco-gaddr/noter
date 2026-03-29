import { encrypt } from '@repo/shared';

const mockFetchWithAuth = jest.fn();

jest.mock('../services/api', () => ({
  fetchWithAuth: (...args: any[]) => mockFetchWithAuth(...args),
}));

describe('mobile ai sync service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFetchWithAuth.mockReset();
  });

  it('deduplicates concurrent pull requests', async () => {
    mockFetchWithAuth.mockResolvedValue({
      conversations: [],
      messages: [],
      projects: [],
    });
    const sync = require('../services/ai/sync');
    await Promise.all([sync.pullAiSync(), sync.pullAiSync(), sync.pullAiSync()]);
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps plaintext values readable when decryption fails', async () => {
    mockFetchWithAuth.mockResolvedValue({
      conversations: [{
        id: 'c1',
        titleEnc: 'Plain title',
        modelEnc: '',
        projectIdEnc: '',
        iconEnc: '',
        iconColorEnc: '',
        createdAtEnc: encrypt('2026-03-12T00:00:00.000Z'),
        updatedAtEnc: encrypt('2026-03-12T00:00:00.000Z'),
      }],
      messages: [],
      projects: [],
    });
    const sync = require('../services/ai/sync');
    const result = await sync.pullAiSync();
    expect(result.conversations[0]?.title).toBe('Plain title');
  });

  it('masks ciphertext values when decryption fails', async () => {
    mockFetchWithAuth.mockResolvedValue({
      conversations: [{
        id: 'c2',
        titleEnc: 'U2FsdGVkX19ciphertextpayloadthatshouldnotrender',
        modelEnc: '',
        projectIdEnc: '',
        iconEnc: '',
        iconColorEnc: '',
        createdAtEnc: encrypt('2026-03-12T00:00:00.000Z'),
        updatedAtEnc: encrypt('2026-03-12T00:00:00.000Z'),
      }],
      messages: [],
      projects: [],
    });
    const sync = require('../services/ai/sync');
    const result = await sync.pullAiSync();
    expect(result.conversations[0]?.title).toBe('');
  });

  it('pushes encrypted payload for conversations, messages and projects', async () => {
    mockFetchWithAuth.mockResolvedValue({});
    const sync = require('../services/ai/sync');

    await sync.pushAiSync({
      conversations: [{
        id: 'c1',
        title: 'Hemlig chatt',
        model: 'gpt',
        createdAt: '2026-03-14T10:00:00.000Z',
        updatedAt: '2026-03-14T10:00:00.000Z',
        messages: [],
      }],
      messages: [{
        conversationId: 'c1',
        message: {
          id: 'm1',
          role: 'user',
          content: 'Hemligt meddelande',
          createdAt: '2026-03-14T10:00:00.000Z',
        },
      }],
      projects: [{
        id: 'p1',
        name: 'Hemligt projekt',
        systemPrompt: 'Hemlig instruktion',
        createdAt: '2026-03-14T10:00:00.000Z',
        updatedAt: '2026-03-14T10:00:00.000Z',
      }],
    });

    const [, req] = mockFetchWithAuth.mock.calls[0];
    const body = JSON.parse(req.body);
    expect(body.conversations[0].titleEnc).toMatch(/^U2FsdGVkX1/);
    expect(body.messages[0].contentEnc).toMatch(/^U2FsdGVkX1/);
    expect(body.projects[0].nameEnc).toMatch(/^U2FsdGVkX1/);
    expect(body.conversations[0].titleEnc).not.toContain('Hemlig chatt');
    expect(body.messages[0].contentEnc).not.toContain('Hemligt meddelande');
    expect(body.projects[0].nameEnc).not.toContain('Hemligt projekt');
  });
});
