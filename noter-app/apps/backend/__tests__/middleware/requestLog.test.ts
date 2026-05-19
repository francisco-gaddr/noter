import { sanitiseUrl } from '../../src/middleware/requestLog';

describe('sanitiseUrl', () => {
  it('strips query strings for non-sensitive URLs', () => {
    expect(sanitiseUrl('/api/notes?foo=bar&baz=42')).toBe('/api/notes');
  });

  it('passes URLs without query through unchanged', () => {
    expect(sanitiseUrl('/api/notes/abc123')).toBe('/api/notes/abc123');
  });

  it('redacts password-reset path components', () => {
    expect(sanitiseUrl('/api/auth/reset-password/very-secret-token-xyz'))
      .toBe('/api/auth/reset-password/<redacted>');
  });

  it('redacts auth verify path components', () => {
    expect(sanitiseUrl('/api/auth/verify/email-token-foo')).toBe('/api/auth/verify/<redacted>');
  });

  it('redacts refresh-token path components', () => {
    expect(sanitiseUrl('/api/auth/refresh/some-token')).toBe('/api/auth/refresh/<redacted>');
  });

  it('still treats bare sensitive prefix as redacted (preserves slot label)', () => {
    // The regex captures the 2-segment prefix as the "endpoint slot" and
    // appends <redacted> as the token placeholder. This keeps metrics
    // sliceable by endpoint while still scrubbing PII.
    expect(sanitiseUrl('/api/auth/reset-password')).toBe('/api/auth/reset-password/<redacted>');
  });

  it('does not redact non-sensitive auth subpaths', () => {
    expect(sanitiseUrl('/api/auth/login')).toBe('/api/auth/login');
  });
});
