import {
  signJwt,
  verifyJwt,
  getCurrentKey,
  getKeyById,
  listActiveKids,
  _resetKeyCache,
  _setKeysForTest,
} from '../../src/utils/jwtKeySet';

const KEY_CURRENT = { kid: 'k-2', secret: 'a'.repeat(32), status: 'current' as const };
const KEY_PREV = { kid: 'k-1', secret: 'b'.repeat(32), status: 'previous' as const };
const KEY_REVOKED = { kid: 'k-0', secret: 'c'.repeat(32), status: 'revoked' as const };

beforeEach(() => {
  _resetKeyCache();
  _setKeysForTest([KEY_REVOKED, KEY_PREV, KEY_CURRENT]);
});

describe('jwtKeySet helpers', () => {
  it('getCurrentKey returns the current one', () => {
    expect(getCurrentKey()?.kid).toBe('k-2');
  });

  it('getKeyById finds by id', () => {
    expect(getKeyById('k-1')?.status).toBe('previous');
    expect(getKeyById('nope')).toBeNull();
  });

  it('listActiveKids excludes revoked', () => {
    expect(listActiveKids()).toEqual(['k-1', 'k-2']);
  });
});

describe('signJwt + verifyJwt', () => {
  it('signs with the current kid and verifies with it', () => {
    const token = signJwt({ sub: 'user-1' });
    const { kid } = verifyJwt(token);
    expect(kid).toBe('k-2');
  });

  it('verifies tokens signed with the previous key (rotation in progress)', () => {
    // Pretend the previous key was once "current" — sign manually with it.
    _setKeysForTest([{ ...KEY_PREV, status: 'current' as const }]);
    const oldToken = signJwt({ sub: 'user-1' });
    // Now restore: prev becomes 'previous', new k-2 is 'current'.
    _setKeysForTest([KEY_PREV, KEY_CURRENT]);
    const { kid } = verifyJwt(oldToken);
    expect(kid).toBe('k-1');
  });

  it('rejects tokens whose kid is revoked', () => {
    _setKeysForTest([{ ...KEY_REVOKED, status: 'current' as const }]);
    const token = signJwt({ sub: 'user-2' });
    _setKeysForTest([KEY_REVOKED, KEY_CURRENT]);
    expect(() => verifyJwt(token)).toThrow(/revoked/);
  });

  it('rejects tokens with unknown kid', () => {
    // Build a token signed with an off-list key.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ sub: 'x' }, 'unknown-key-' + 'z'.repeat(32), { keyid: 'totally-not-known' });
    expect(() => verifyJwt(token)).toThrow(/unknown kid/);
  });

  it('falls back to trying every active key when no kid is in the token', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ sub: 'legacy' }, KEY_PREV.secret); // no `keyid`
    const { kid } = verifyJwt(token);
    expect(kid).toBe('k-1');
  });
});
