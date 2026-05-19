import { _parseToken, _sha256, _PREFIX } from '../../src/middleware/apiKeyAuth';

describe('apiKey parseToken', () => {
  it('parses well-formed token', () => {
    const token = `${_PREFIX}abcdef12_${'a'.repeat(32)}`;
    expect(_parseToken(token)).toEqual({ kid: 'abcdef12', secret: 'a'.repeat(32) });
  });

  it('rejects token without prefix', () => {
    expect(_parseToken(`abcdef12_${'a'.repeat(32)}`)).toBeNull();
  });

  it('rejects kid that is too short / too long / contains uppercase', () => {
    expect(_parseToken(`${_PREFIX}short_${'a'.repeat(32)}`)).toBeNull();
    expect(_parseToken(`${_PREFIX}ABCDEF12_${'a'.repeat(32)}`)).toBeNull();
    expect(_parseToken(`${_PREFIX}abcdef12345_${'a'.repeat(32)}`)).toBeNull();
  });

  it('rejects secret that is wrong length', () => {
    expect(_parseToken(`${_PREFIX}abcdef12_${'a'.repeat(20)}`)).toBeNull();
    expect(_parseToken(`${_PREFIX}abcdef12_${'a'.repeat(50)}`)).toBeNull();
  });

  it('rejects secret with disallowed characters', () => {
    expect(_parseToken(`${_PREFIX}abcdef12_${'a'.repeat(31)}=`)).toBeNull();
    expect(_parseToken(`${_PREFIX}abcdef12_${'a'.repeat(30)} b`)).toBeNull();
  });

  it('rejects non-string / over-long input', () => {
    expect(_parseToken('')).toBeNull();
    // @ts-expect-error testing invalid input
    expect(_parseToken(null)).toBeNull();
    expect(_parseToken('x'.repeat(200))).toBeNull();
  });

  it('rejects tokens with too many parts after prefix', () => {
    expect(_parseToken(`${_PREFIX}abcdef12_${'a'.repeat(32)}_extra`)).toBeNull();
  });
});

describe('apiKey sha256', () => {
  it('produces 64-hex output', () => {
    const h = _sha256('hello');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(_sha256('x')).toBe(_sha256('x'));
    expect(_sha256('x')).not.toBe(_sha256('y'));
  });
});
