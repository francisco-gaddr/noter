import { extractTenantClaims } from '../../src/middleware/authMiddleware';

describe('extractTenantClaims', () => {
  it('returns empty object for string-typed decoded JWT', () => {
    expect(extractTenantClaims('not-a-jwt-object' as unknown as any)).toEqual({});
  });

  it('reads orgId from `orgId` claim', () => {
    expect(extractTenantClaims({ orgId: 'acme' } as any).orgId).toBe('acme');
  });

  it('falls back to org_id / tenantId / tenant_id', () => {
    expect(extractTenantClaims({ org_id: 'a' } as any).orgId).toBe('a');
    expect(extractTenantClaims({ tenantId: 'b' } as any).orgId).toBe('b');
    expect(extractTenantClaims({ tenant_id: 'c' } as any).orgId).toBe('c');
  });

  it('trims whitespace and rejects empty', () => {
    expect(extractTenantClaims({ orgId: '   ' } as any).orgId).toBeUndefined();
    expect(extractTenantClaims({ orgId: ' acme ' } as any).orgId).toBe('acme');
  });

  it('parses roles as array', () => {
    expect(extractTenantClaims({ roles: ['admin', 'editor'] } as any).roles).toEqual(['admin', 'editor']);
  });

  it('parses scopes as space-delimited string', () => {
    expect(extractTenantClaims({ scope: 'read:notes write:notes' } as any).scopes).toEqual(['read:notes', 'write:notes']);
  });

  it('parses scopes as comma-delimited string', () => {
    expect(extractTenantClaims({ scopes: 'read:notes,write:notes' } as any).scopes).toEqual(['read:notes', 'write:notes']);
  });

  it('drops empty role list', () => {
    expect(extractTenantClaims({ roles: [] } as any).roles).toBeUndefined();
    expect(extractTenantClaims({ roles: '' } as any).roles).toBeUndefined();
  });

  it('preserves plan when string', () => {
    expect(extractTenantClaims({ plan: 'pro' } as any).plan).toBe('pro');
    expect(extractTenantClaims({ plan: '' } as any).plan).toBeUndefined();
    expect(extractTenantClaims({ plan: 42 } as any).plan).toBeUndefined();
  });
});
