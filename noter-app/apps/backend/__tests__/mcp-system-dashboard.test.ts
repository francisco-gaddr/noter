const noteFindMock = jest.fn();
const taskFindMock = jest.fn();
const conversationCountMock = jest.fn();
const messageFindMock = jest.fn();
const mcpAuditCountMock = jest.fn();
const listMcpAuditMock = jest.fn();

jest.mock('../src/models/Note', () => ({
  __esModule: true,
  default: { find: (...args: any[]) => noteFindMock(...args) },
}));

jest.mock('../src/models/Task', () => ({
  __esModule: true,
  default: { find: (...args: any[]) => taskFindMock(...args) },
}));

jest.mock('../src/models/AIConversationSync', () => ({
  __esModule: true,
  default: { countDocuments: (...args: any[]) => conversationCountMock(...args) },
}));

jest.mock('../src/models/AIMessageSync', () => ({
  __esModule: true,
  default: { find: (...args: any[]) => messageFindMock(...args) },
}));

jest.mock('../src/models/McpAuditLog', () => ({
  __esModule: true,
  default: { countDocuments: (...args: any[]) => mcpAuditCountMock(...args) },
}));

jest.mock('../src/services/mcp/auditStore', () => ({
  listMcpAuditForUser: (...args: any[]) => listMcpAuditMock(...args),
}));

describe('mcp system dashboard service', () => {
  const { getSystemDashboardForUser } = require('../src/services/mcp/systemDashboard');

  beforeEach(() => {
    noteFindMock.mockReset();
    taskFindMock.mockReset();
    conversationCountMock.mockReset();
    messageFindMock.mockReset();
    mcpAuditCountMock.mockReset();
    listMcpAuditMock.mockReset();
  });

  it('builds scoped summary with usage series and heatmap', async () => {
    noteFindMock.mockReturnValue({
      lean: async () => [{ userId: 'u1', createdAt: new Date().toISOString() }],
    });
    taskFindMock.mockReturnValue({
      lean: async () => [
        { userId: 'u1', createdAt: new Date().toISOString(), completed: 'true', updatedAt: new Date().toISOString() },
      ],
    });
    conversationCountMock.mockResolvedValue(2);
    messageFindMock.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [
            { roleEnc: 'user', contentEnc: 'hej dashboard', createdAt: new Date() },
            { roleEnc: 'assistant', contentEnc: 'hej tillbaka', createdAt: new Date() },
          ],
        }),
      }),
    });
    mcpAuditCountMock.mockResolvedValue(5);
    listMcpAuditMock.mockResolvedValue([
      { at: Date.now(), userId: 'u1', service: 'notion', action: 'call_tool', ok: true, toolName: 'notion.search' },
    ]);

    const result = await getSystemDashboardForUser({ userId: 'u1', range: '30d', group: 'day', sort: 'desc', logLimit: 120 });
    expect(result.userId).toBe('u1');
    expect(result.summary.notesTotal).toBe(1);
    expect(result.summary.tasksTotal).toBe(1);
    expect(result.summary.tasksCompletedTotal).toBe(1);
    expect(result.logs.mcpAudit[0].toolName).toBe('notion.search');
    expect(Array.isArray(result.usageSeries)).toBe(true);
    expect(result.usageHeatmap.hourByWeekday.length).toBe(7);
  });

  it('applies role/service/action filters and exposes available filters', async () => {
    noteFindMock.mockReturnValue({ lean: async () => [] });
    taskFindMock.mockReturnValue({ lean: async () => [] });
    conversationCountMock.mockResolvedValue(1);
    messageFindMock.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [
            { roleEnc: 'user', contentEnc: 'ett två tre', createdAt: new Date('2026-03-11T10:00:00.000Z') },
            { roleEnc: 'assistant', contentEnc: 'fyra fem', createdAt: new Date('2026-03-11T10:10:00.000Z') },
          ],
        }),
      }),
    });
    mcpAuditCountMock.mockResolvedValue(3);
    listMcpAuditMock.mockResolvedValue([
      { at: new Date('2026-03-11T10:15:00.000Z').getTime(), userId: 'u1', service: 'notion', action: 'call_tool', ok: true, toolName: 'notion.search' },
      { at: new Date('2026-03-11T10:20:00.000Z').getTime(), userId: 'u1', service: 'slack', action: 'list_tools', ok: true, toolName: 'slack.search' },
    ]);
    const result = await getSystemDashboardForUser({
      userId: 'u1',
      range: '30d',
      group: 'day',
      sort: 'desc',
      role: 'user',
      service: 'notion',
      action: 'call_tool',
      from: '2026-03-10T00:00:00.000Z',
      to: '2026-03-12T00:00:00.000Z',
      logLimit: 120,
    });
    expect(result.summary.aiMessagesInRange).toBe(1);
    expect(result.logs.aiMessages.length).toBe(1);
    expect(result.logs.mcpAudit.length).toBe(1);
    expect(result.logs.mcpAudit[0].service).toBe('notion');
    expect(result.availableFilters.services).toContain('notion');
    expect(result.availableFilters.actions).toContain('call_tool');
    expect(result.availableFilters.roles).toContain('assistant');
    expect(result.filters.role).toBe('user');
  });
});
