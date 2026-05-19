import { resolveTrustProxy } from '../../src/utils/trustProxy';

describe('resolveTrustProxy', () => {
  it('defaults to 1 when env unset', () => {
    expect(resolveTrustProxy(undefined)).toBe(1);
    expect(resolveTrustProxy('')).toBe(1);
  });

  it('parses integer hop counts', () => {
    expect(resolveTrustProxy('0')).toBe(false); // '0' → no proxies trusted
    expect(resolveTrustProxy('1')).toBe(1);
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('10')).toBe(10);
  });

  it('rejects unreasonable hop counts and defaults to 1', () => {
    expect(resolveTrustProxy('100')).toBe(1);
    expect(resolveTrustProxy('-1')).toBe(1);
    expect(resolveTrustProxy('abc')).toBe(1);
  });

  it('accepts named subnet aliases', () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback');
    expect(resolveTrustProxy('linklocal')).toBe('linklocal');
    expect(resolveTrustProxy('uniquelocal')).toBe('uniquelocal');
  });

  it("'false' disables trust-proxy", () => {
    expect(resolveTrustProxy('false')).toBe(false);
  });

  it("'true' trusts every hop", () => {
    expect(resolveTrustProxy('true')).toBe(true);
  });

  it('passes CIDR lists through unchanged', () => {
    expect(resolveTrustProxy('10.0.0.0/8, 192.168.1.1')).toBe('10.0.0.0/8, 192.168.1.1');
    expect(resolveTrustProxy('127.0.0.1')).toBe('127.0.0.1');
  });
});
