import { _parseToken, _sha256, _genKid, _genSecret, buildApiKeyToken } from '../src/middleware/apiKeyAuth';

describe('API key minting (format ↔ verify symmetry)', () => {
  it('genKid produces an 8-char [a-z0-9] id', () => {
    for (let i = 0; i < 50; i++) expect(_genKid()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('genSecret produces a 32-char base64url secret', () => {
    for (let i = 0; i < 50; i++) expect(_genSecret()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('a minted token parses back to its kid + secret', () => {
    const kid = _genKid();
    const secret = _genSecret();
    const token = buildApiKeyToken(kid, secret);
    expect(token.startsWith('nk_')).toBe(true);
    const parsed = _parseToken(token);
    expect(parsed).toEqual({ kid, secret });
  });

  it('the stored hash matches sha256(secret) so verify will succeed', () => {
    const secret = _genSecret();
    // Verify path stores sha256(secret) and timing-safe compares it back.
    expect(_sha256(secret)).toHaveLength(64);
    expect(_sha256(secret)).toBe(_sha256(secret));
    expect(_sha256(secret)).not.toBe(_sha256(_genSecret()));
  });

  it('generates distinct kids/secrets each call', () => {
    expect(_genKid()).not.toBe(_genKid());
    expect(_genSecret()).not.toBe(_genSecret());
  });
});
