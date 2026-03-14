import express from 'express';
import bodyParser from 'body-parser';
import request from 'supertest';
import { authMiddleware } from '../src/middleware/authMiddleware';
import mcpRoutesImport from '../src/routes/mcp';

const listToolsMock = jest.fn();
const callToolMock = jest.fn();
const healthMock = jest.fn();
const dashboardMock = jest.fn();
const systemDashboardMock = jest.fn();

jest.mock('../src/services/mcp/runtime', () => ({
  mcpRuntime: {
    listTools: (...args: any[]) => listToolsMock(...args),
    callTool: (...args: any[]) => callToolMock(...args),
    health: (...args: any[]) => healthMock(...args),
    dashboard: (...args: any[]) => dashboardMock(...args),
  },
}));

jest.mock('../src/services/mcp/systemDashboard', () => ({
  getSystemDashboardForUser: (...args: any[]) => systemDashboardMock(...args),
}));

describe('mcp routes', () => {
  const mcpRoutes: any = (mcpRoutesImport as any)?.default || mcpRoutesImport;
  const app = express();
  app.use(bodyParser.json());
  app.use('/api/mcp', authMiddleware, mcpRoutes);

  beforeEach(() => {
    listToolsMock.mockReset();
    callToolMock.mockReset();
    healthMock.mockReset();
    dashboardMock.mockReset();
    systemDashboardMock.mockReset();
  });

  it('lists tools for authenticated user', async () => {
    listToolsMock.mockResolvedValue({ tools: [{ name: 'search' }] });
    const plainSettings = { notion: { enabled: true, values: { apiToken: 'plain' } } };
    const res = await request(app)
      .post('/api/mcp/tools')
      .set('Authorization', 'Bearer demo-token')
      .send({ service: 'notion', mcpUiSettings: plainSettings, mcpUiSettingsEnc: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('notion');
    expect(listToolsMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user-id',
      service: 'notion',
      mcpUiSettingsPayload: plainSettings,
    }));
  });

  it('calls tool with intent text', async () => {
    callToolMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const res = await request(app)
      .post('/api/mcp/call')
      .set('Authorization', 'Bearer demo-token')
      .send({
        service: 'googleWorkspace',
        toolName: 'calendar_create_event',
        args: { title: 'Möte' },
        intentText: 'lägg till i google calendar',
      });
    expect(res.status).toBe(200);
    expect(callToolMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user-id',
      service: 'googleWorkspace',
      toolName: 'calendar_create_event',
      intentText: 'lägg till i google calendar',
    }));
  });

  it('rejects invalid service', async () => {
    const res = await request(app)
      .post('/api/mcp/tools')
      .set('Authorization', 'Bearer demo-token')
      .send({ service: 'invalid-service' });
    expect(res.status).toBe(400);
  });

  it('returns user scoped health', async () => {
    healthMock.mockReturnValue({ sessionCount: 0, sessions: [], failures: [], recentAudit: [] });
    const res = await request(app)
      .get('/api/mcp/health')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(200);
    expect(healthMock).toHaveBeenCalledWith({ userId: 'demo-user-id' });
  });

  it('returns encrypted audit dashboard scoped to current user', async () => {
    dashboardMock.mockResolvedValue({ userId: 'demo-user-id', persistedAudit: [], runtimeHealth: { sessionCount: 0 } });
    const res = await request(app)
      .get('/api/mcp/dashboard?limit=25')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(200);
    expect(dashboardMock).toHaveBeenCalledWith({ userId: 'demo-user-id', limit: 25 });
  });

  it('returns user scoped system dashboard with filters', async () => {
    systemDashboardMock.mockResolvedValue({ userId: 'demo-user-id', summary: { notesTotal: 1 } });
    const res = await request(app)
      .get('/api/mcp/dashboard/system?range=30d&group=day&sort=desc&logLimit=150&service=notion&action=call_tool&role=user&from=2026-03-01T00:00:00.000Z&to=2026-03-12T23:59:59.000Z')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(200);
    expect(systemDashboardMock).toHaveBeenCalledWith({
      userId: 'demo-user-id',
      range: '30d',
      group: 'day',
      sort: 'desc',
      logLimit: '150',
      service: 'notion',
      action: 'call_tool',
      role: 'user',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-12T23:59:59.000Z',
    });
  });
});
