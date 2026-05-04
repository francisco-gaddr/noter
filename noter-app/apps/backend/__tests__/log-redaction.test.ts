import { sanitizeLogInfo } from '../src/utils/logRedaction';

describe('sanitizeLogInfo', () => {
  it('redacts sensitive keys and bearer strings', () => {
    const input: any = {
      level: 'info',
      message: 'test',
      authorization: 'Bearer abc.def.ghi',
      password: 'secret',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig',
      nested: {
        refreshToken: 'refresh',
        headers: {
          Authorization: 'Bearer something',
          other: 'value',
        },
        authHeader: 'Bearer 123',
      },
    };

    const out = sanitizeLogInfo(input);

    expect(out.level).toBe('info');
    expect(out.message).toBe('test');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.nested.refreshToken).toBe('[REDACTED]');
    expect(out.nested.headers.Authorization).toBe('[REDACTED]');
    expect(out.nested.headers.other).toBe('value');
    expect(out.nested.authHeader).toBe('Bearer [REDACTED]');
  });
});

