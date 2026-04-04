import { createCipheriv, createHash, randomBytes } from 'crypto';

const createMock = jest.fn();
const findMock = jest.fn();

jest.mock('../src/models/McpAuditLog', () => ({
  __esModule: true,
  default: {
    create: (...args: any[]) => createMock(...args),
    find: (...args: any[]) => findMock(...args),
  },
}));

describe('mcp audit store encryption', () => {
  const { appendMcpAudit, listMcpAuditForUser } = require('../src/services/mcp/auditStore');

  beforeEach(() => {
    createMock.mockReset();
    findMock.mockReset();
    process.env.NODE_ENV = 'test';
    delete process.env.MCP_AUDIT_MASTER_KEYS;
    delete process.env.MCP_AUDIT_ACTIVE_KEY_ID;
    process.env.MCP_AUDIT_MASTER_KEY = 'test-master';
  });

  it('stores encrypted payload and decrypts only for same user', async () => {
    let storedPayload = '';
    createMock.mockImplementation(async (doc: any) => {
      storedPayload = String(doc.payloadEnc || '');
      return doc;
    });
    await appendMcpAudit({
      at: Date.now(),
      userId: 'u1',
      service: 'notion',
      action: 'call_tool',
      ok: true,
      toolName: 'notion.search',
    });
    expect(storedPayload).toContain('.');
    expect(storedPayload).not.toContain('notion.search');

    findMock.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [{ userId: 'u1', payloadEnc: storedPayload }],
        }),
      }),
    });
    const list = await listMcpAuditForUser({ userId: 'u1', limit: 20 });
    expect(list.length).toBe(1);
    expect(list[0].toolName).toBe('notion.search');
  });

  it('uses active key id for rotated encryption format', async () => {
    process.env.MCP_AUDIT_MASTER_KEYS = 'k1:alpha-secret,k2:beta-secret';
    process.env.MCP_AUDIT_ACTIVE_KEY_ID = 'k2';
    let storedPayload = '';
    createMock.mockImplementation(async (doc: any) => {
      storedPayload = String(doc.payloadEnc || '');
      return doc;
    });
    await appendMcpAudit({
      at: Date.now(),
      userId: 'u-rot',
      service: 'slack',
      action: 'list_tools',
      ok: true,
    });
    expect(storedPayload.startsWith('v1.k2.')).toBe(true);
  });

  it('decrypts legacy 3-part payload with current key material', async () => {
    const raw = JSON.stringify({
      at: Date.now(),
      userId: 'legacy-user',
      service: 'notion',
      action: 'call_tool',
      ok: true,
      toolName: 'notion.search',
    });
    const key = createHash('sha256').update(process.env.MCP_AUDIT_MASTER_KEY as string).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacyPayload = `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
    findMock.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [{ userId: 'legacy-user', payloadEnc: legacyPayload }],
        }),
      }),
    });
    const list = await listMcpAuditForUser({ userId: 'legacy-user', limit: 20 });
    expect(list.length).toBe(1);
    expect(list[0].toolName).toBe('notion.search');
  });

  it('fails closed in production when audit encryption keys are missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MCP_AUDIT_MASTER_KEY;

    await expect(
      appendMcpAudit({
        at: Date.now(),
        userId: 'prod-user',
        service: 'notion',
        action: 'error',
        ok: false,
        message: 'missing-key',
      }),
    ).rejects.toThrow('MCP_AUDIT_MASTER_KEY or MCP_AUDIT_MASTER_KEYS must be set in production');
  });
});
