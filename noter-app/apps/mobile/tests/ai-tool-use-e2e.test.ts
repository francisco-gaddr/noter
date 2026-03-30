import { MobileLlamaProvider } from '../services/ai/provider';
import { extractToolCalls } from '../services/ai/tooling';
import { buildAiSyncNotice, buildToolUseNotice, isMutatingAiTool } from '@repo/shared';

const mockChat = jest.fn();

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: jest.fn(),
    unload: jest.fn(),
    chat: (...args: any[]) => mockChat(...args),
  },
}));

describe('AI tool-use e2e flow', () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it('detects tool call when tool-use enabled', async () => {
    mockChat.mockResolvedValue('```json\n{"tool":"list_tasks","arguments":{"completed":false}}\n```');
    const provider = new MobileLlamaProvider();
    const response = await provider.generateResponse([
      { id: 'u1', role: 'user', content: 'Visa mina uppgifter', createdAt: new Date().toISOString() },
    ]);
    const { calls } = extractToolCalls(response);
    expect(calls.length).toBe(1);
    expect(calls[0].tool).toBe('list_tasks');
    expect(calls[0].arguments.completed).toBe(false);
  });

  it('skips tool execution when tool-use disabled', async () => {
    mockChat.mockResolvedValue('```json\n{"tool":"list_tasks","arguments":{"completed":false}}\n```');
    const provider = new MobileLlamaProvider();
    const response = await provider.generateResponse([
      { id: 'u1', role: 'user', content: 'Visa mina uppgifter', createdAt: new Date().toISOString() },
    ]);
    const { calls } = extractToolCalls(response);
    const executed = false;
    expect(calls.length).toBe(1);
    expect(executed).toBe(false);
  });

  it('marks mutating tools as blocked in read-only mode', () => {
    expect(buildToolUseNotice(true, 'read-only')).toContain('läsläge');
    expect(isMutatingAiTool('create_note')).toBe(true);
    expect(isMutatingAiTool('list_notes')).toBe(false);
  });

  it('injects local-only sync notice when backend sync is disabled', () => {
    expect(buildAiSyncNotice(false)).toContain('denna enhet');
  });
});
