import express from 'express';
import { McpIntegrationId } from '@repo/shared';
import { AuthRequest } from '../middleware/authMiddleware';
import { mcpRuntime } from '../services/mcp/runtime';
import { getSystemDashboardForUser } from '../services/mcp/systemDashboard';

const router = express.Router();

const allowedServices = new Set<McpIntegrationId>(['slack', 'googleWorkspace', 'notion', 'filesystem', 'playwright']);

const parseService = (raw: unknown): McpIntegrationId => {
  const service = typeof raw === 'string' ? raw.trim() : '';
  if (!allowedServices.has(service as McpIntegrationId)) {
    throw new Error('Ogiltig MCP-tjänst');
  }
  return service as McpIntegrationId;
};

router.post('/tools', async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const service = parseService(req.body?.service);
    const result = await mcpRuntime.listTools({
      userId,
      service,
      mcpUiSettingsPayload: req.body?.mcpUiSettings ?? req.body?.mcpUiSettingsEnc,
    });
    return res.json({ service, result });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kunde inte lista MCP-tools' });
  }
});

router.post('/call', async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const service = parseService(req.body?.service);
    const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName.trim() : '';
    if (!toolName) {
      return res.status(400).json({ message: 'toolName krävs' });
    }
    const args = req.body?.args && typeof req.body.args === 'object' && !Array.isArray(req.body.args) ? req.body.args : {};
    const result = await mcpRuntime.callTool({
      userId,
      service,
      toolName,
      args,
      intentText: typeof req.body?.intentText === 'string' ? req.body.intentText : '',
      mcpUiSettingsPayload: req.body?.mcpUiSettings ?? req.body?.mcpUiSettingsEnc,
    });
    return res.json({ service, toolName, result });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kunde inte köra MCP-tool' });
  }
});

router.get('/health', async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const health = mcpRuntime.health({ userId });
    return res.json(health);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kunde inte läsa MCP-status' });
  }
});

router.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 200)) : 50;
    const data = await mcpRuntime.dashboard({ userId, limit });
    return res.json(data);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kunde inte läsa MCP-dashboard' });
  }
});

router.get('/dashboard/system', async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const data = await getSystemDashboardForUser({
      userId,
      range: req.query?.range,
      group: req.query?.group,
      sort: req.query?.sort,
      logLimit: req.query?.logLimit,
      from: req.query?.from,
      to: req.query?.to,
      service: req.query?.service,
      action: req.query?.action,
      role: req.query?.role,
    });
    return res.json(data);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kunde inte läsa systemdashboard' });
  }
});

export default router;
