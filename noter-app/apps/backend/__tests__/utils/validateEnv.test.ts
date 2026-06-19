import { validateBackendEnv } from '../../src/utils/validateEnv';

const strongSecret = 'x'.repeat(48);

describe('validateBackendEnv', () => {
  it('accepts a strong JWT_SECRET with no errors', () => {
    const r = validateBackendEnv({ JWT_SECRET: strongSecret, MONGO_URI: 'm', REDIS_URL: 'r' }, { production: true });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('errors when NO JWT signing key is configured (the one fatal case)', () => {
    const r = validateBackendEnv({ MONGO_URI: 'm' }, { production: true });
    expect(r.errors.join(' ')).toMatch(/JWT signing key/i);
  });

  it('accepts a JWT_KEYS array with a current key and needs no JWT_SECRET', () => {
    const JWT_KEYS = JSON.stringify([{ kid: 'a', status: 'current', secret: strongSecret }]);
    const r = validateBackendEnv({ JWT_KEYS, MONGO_URI: 'm', REDIS_URL: 'r' }, { production: true });
    expect(r.errors).toEqual([]);
  });

  it('errors when JWT_KEYS has no current key AND no JWT_SECRET fallback', () => {
    const JWT_KEYS = JSON.stringify([{ kid: 'a', status: 'retired', secret: strongSecret }]);
    const r = validateBackendEnv({ JWT_KEYS }, { production: true });
    expect(r.errors.join(' ')).toMatch(/JWT signing key/i);
  });

  it('warns (does not error) on a short or placeholder JWT_SECRET', () => {
    const short = validateBackendEnv({ JWT_SECRET: 'short', MONGO_URI: 'm', REDIS_URL: 'r' }, { production: true });
    expect(short.errors).toEqual([]);
    expect(short.warnings.join(' ')).toMatch(/shorter than 32/i);

    const placeholder = validateBackendEnv({ JWT_SECRET: 'replace-with-a-local-secret-value-please-1234', MONGO_URI: 'm', REDIS_URL: 'r' }, { production: true });
    expect(placeholder.warnings.join(' ')).toMatch(/placeholder|default/i);
  });

  it('warns about missing MONGO_URI / REDIS_URL only in production', () => {
    const prod = validateBackendEnv({ JWT_SECRET: strongSecret }, { production: true });
    expect(prod.warnings.join(' ')).toMatch(/MONGO_URI/);
    expect(prod.warnings.join(' ')).toMatch(/REDIS_URL/);

    const dev = validateBackendEnv({ JWT_SECRET: strongSecret }, { production: false });
    expect(dev.warnings.join(' ')).not.toMatch(/MONGO_URI/);
    expect(dev.warnings.join(' ')).not.toMatch(/REDIS_URL/);
  });

  it('warns on an unparseable numeric env but never errors', () => {
    const r = validateBackendEnv({ JWT_SECRET: strongSecret, MONGO_URI: 'm', REDIS_URL: 'r', PORT: 'abc' }, { production: true });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/PORT/);
  });

  it('malformed JWT_KEYS JSON falls back to JWT_SECRET without throwing', () => {
    const r = validateBackendEnv({ JWT_KEYS: '{not json', JWT_SECRET: strongSecret, MONGO_URI: 'm', REDIS_URL: 'r' }, { production: true });
    expect(r.errors).toEqual([]);
  });
});
