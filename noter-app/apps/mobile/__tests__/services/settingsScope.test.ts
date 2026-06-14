import { decodeJwtUserId, stableScopeForToken } from '@/services/ai/settingsScope';

// Build a fake JWT (header.payload.signature) with a base64url payload; signature is
// irrelevant — we only decode the unverified payload for a local namespace key.
const b64url = (obj: any) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: any) => `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.sig`;

describe('settingsScope.decodeJwtUserId', () => {
  it('decodes the userId claim', () => {
    expect(decodeJwtUserId(jwt({ userId: '64f0abc', iat: 1, exp: 2 }))).toBe('64f0abc');
  });

  it('falls back to id / sub claims', () => {
    expect(decodeJwtUserId(jwt({ id: 'aaa' }))).toBe('aaa');
    expect(decodeJwtUserId(jwt({ sub: 'bbb' }))).toBe('bbb');
  });

  it('is stable across tokens that differ only by iat/exp (the rotation case)', () => {
    const a = decodeJwtUserId(jwt({ userId: 'u1', iat: 100, exp: 200 }));
    const b = decodeJwtUserId(jwt({ userId: 'u1', iat: 999, exp: 1999 }));
    expect(a).toBe('u1');
    expect(b).toBe('u1'); // same user → same scope even though the token string changed
  });

  it('returns null for missing / malformed tokens', () => {
    expect(decodeJwtUserId(null)).toBeNull();
    expect(decodeJwtUserId('')).toBeNull();
    expect(decodeJwtUserId('not-a-jwt')).toBeNull();
    expect(decodeJwtUserId(jwt({ foo: 'bar' }))).toBeNull();
  });
});

describe('settingsScope.stableScopeForToken', () => {
  it('namespaces per user and is anon when logged out', () => {
    expect(stableScopeForToken(jwt({ userId: 'u1' }))).toBe('u_u1');
    expect(stableScopeForToken(null)).toBe('anon');
    expect(stableScopeForToken('garbage')).toBe('anon');
  });
});
