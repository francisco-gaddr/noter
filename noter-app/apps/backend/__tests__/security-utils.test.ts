describe('security utility fallbacks', () => {
  const originalEnv = { ...process.env };

  const restoreRelevantEnv = () => {
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
    delete process.env.CORS_ORIGINS;
    delete process.env.ALLOW_DEMO_TOKEN;
    delete process.env.MCP_AUDIT_MASTER_KEY;
    delete process.env.MCP_AUDIT_MASTER_KEYS;
  };

  const loadSecurityModule = () => {
    jest.resetModules();
    return require('../src/utils/security') as typeof import('../src/utils/security');
  };

  beforeEach(() => {
    restoreRelevantEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('disables demo token by default until explicitly enabled', () => {
    const { isDemoTokenEnabled } = loadSecurityModule();
    expect(isDemoTokenEnabled()).toBe(false);
    process.env.ALLOW_DEMO_TOKEN = 'true';
    expect(isDemoTokenEnabled()).toBe(true);
  });

  it('uses loopback origins only in non-production when no explicit origins are configured', () => {
    process.env.NODE_ENV = 'development';
    const { getAllowedOrigins } = loadSecurityModule();
    expect(getAllowedOrigins()).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8081',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ]);
  });

  it('fails closed for production cors when no explicit origin list exists', () => {
    process.env.NODE_ENV = 'production';
    const { getAllowedOrigins } = loadSecurityModule();
    expect(getAllowedOrigins()).toEqual([]);
  });

  it('generates an ephemeral jwt fallback outside production instead of using a committed secret', () => {
    process.env.NODE_ENV = 'test';
    const { getJwtSecret } = loadSecurityModule();
    const first = getJwtSecret();
    const second = getJwtSecret();
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe('dev-insecure-secret-change-me');
  });

  it('requires an explicit audit master key in production when no key ring is configured', () => {
    process.env.NODE_ENV = 'production';
    const { getMcpAuditMasterKey } = loadSecurityModule();
    expect(() => getMcpAuditMasterKey()).toThrow(
      'MCP_AUDIT_MASTER_KEY or MCP_AUDIT_MASTER_KEYS must be set in production',
    );
  });
});
