import { redactLogValue, sanitizeErrorForLog } from '../services/logRedaction';

describe('mobile logRedaction', () => {
  it('redacts nested sensitive keys and bearer strings', () => {
    const input: any = {
      token: 'secret-token',
      nested: {
        Authorization: 'Bearer abc',
        refreshToken: 'refresh',
        ok: 'value',
      },
      arr: [{ password: 'pw' }],
    };

    expect(redactLogValue(input)).toEqual({
      token: '[REDACTED]',
      nested: {
        Authorization: '[REDACTED]',
        refreshToken: '[REDACTED]',
        ok: 'value',
      },
      arr: [{ password: '[REDACTED]' }],
    });
    expect(redactLogValue('Bearer abc')).toBe('Bearer [REDACTED]');
  });

  it('sanitizes errors without leaking details', () => {
    const err: any = new Error('fail');
    err.url = 'https://example.com';
    err.details = { token: 'secret-token', other: 'ok' };

    expect(sanitizeErrorForLog(err)).toEqual({
      name: 'Error',
      message: 'fail',
      status: undefined,
      url: 'https://example.com',
      method: undefined,
      code: undefined,
      details: { token: '[REDACTED]', other: 'ok' },
    });
  });
});

