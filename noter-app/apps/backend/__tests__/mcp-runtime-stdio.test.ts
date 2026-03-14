import { EventEmitter } from 'events';
import { createEmptyMcpUiSettings } from '@repo/shared';

const spawnMock = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

const createMockChild = () => {
  const emitter = new EventEmitter() as any;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = jest.fn();
  emitter.stdin = {
    write: jest.fn((raw: string) => {
      const line = String(raw).trim();
      if (!line) return true;
      const payload = JSON.parse(line);
      if (payload.method === 'initialize') {
        emitter.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { capabilities: {} } })}\n`));
      } else if (payload.method === 'tools/list') {
        emitter.stdout.emit('data', Buffer.from(`${JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: { tools: [{ name: 'notion.search', description: 'search notion' }] },
        })}\n`));
      } else if (payload.method === 'tools/call') {
        emitter.stdout.emit('data', Buffer.from(`${JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        })}\n`));
      }
      return true;
    }),
  };
  return emitter;
};

describe('mcp runtime stdio integration', () => {
  const { mcpRuntime, mcpRuntimeInternals } = require('../src/services/mcp/runtime');

  beforeEach(() => {
    spawnMock.mockReset();
    mcpRuntimeInternals.reset();
    spawnMock.mockImplementation(() => createMockChild());
  });

  it('handles initialize -> tools/list -> tools/call via stdio', async () => {
    const ui = createEmptyMcpUiSettings();
    ui.notion.enabled = true;
    ui.notion.values.apiToken = 'ui-token';
    const listResult = await mcpRuntime.listTools({
      userId: 'demo-user-id',
      service: 'notion',
      mcpUiSettingsPayload: ui,
    });
    expect(Array.isArray(listResult.tools)).toBe(true);
    const callResult = await mcpRuntime.callTool({
      userId: 'demo-user-id',
      service: 'notion',
      toolName: 'notion.search',
      args: { query: 'roadmap' },
      intentText: 'sök i notion',
      mcpUiSettingsPayload: ui,
    });
    expect(callResult.content?.[0]?.text).toBe('ok');
    expect(spawnMock).toHaveBeenCalled();
  });
});
