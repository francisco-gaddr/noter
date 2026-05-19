import { signVapidJwt, subscriptionFingerprint, generateVapidKeyPair, _resetCache } from '../../src/services/webPush';

beforeEach(() => _resetCache());

describe('generateVapidKeyPair', () => {
  it('produces a valid base64url public key and PEM private key', () => {
    const { publicKey, privateKeyPem } = generateVapidKeyPair();
    expect(typeof publicKey).toBe('string');
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    // Uncompressed P-256 = 65 bytes raw → ~87 chars base64url.
    expect(publicKey.length).toBeGreaterThanOrEqual(86);
    expect(privateKeyPem).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(privateKeyPem).toMatch(/-----END PRIVATE KEY-----/);
  });
});

describe('signVapidJwt', () => {
  const { privateKeyPem } = generateVapidKeyPair();

  it('produces a 3-segment JWT', () => {
    const jwt = signVapidJwt('https://push.example.com', {
      subject: 'mailto:dev@noter.app',
      privateKeyPem,
    });
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('header includes ES256', () => {
    const jwt = signVapidJwt('https://push.example.com', { subject: 'mailto:x@y.z', privateKeyPem });
    const headerJson = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'));
    expect(headerJson.alg).toBe('ES256');
    expect(headerJson.typ).toBe('JWT');
  });

  it('payload carries aud + sub + exp', () => {
    const jwt = signVapidJwt('https://push.example.com', { subject: 'mailto:x@y.z', privateKeyPem });
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.aud).toBe('https://push.example.com');
    expect(payload.sub).toBe('mailto:x@y.z');
    expect(typeof payload.exp).toBe('number');
  });

  it('caps exp at 12 hours', () => {
    const now = 1700000000;
    const jwt = signVapidJwt('https://push.example.com', {
      subject: 'mailto:x@y.z',
      privateKeyPem,
      expSeconds: 99999999, // huge value — should clamp
      now: () => now,
    });
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.exp).toBe(now + 12 * 60 * 60);
  });

  it('rejects non-URL audience', () => {
    expect(() => signVapidJwt('not-a-url', { subject: 'x', privateKeyPem })).toThrow(/audience/);
  });

  it('rejects non-PEM private key', () => {
    expect(() => signVapidJwt('https://x.com', { subject: 'x', privateKeyPem: 'not-a-pem' })).toThrow(/PEM/);
  });
});

describe('subscriptionFingerprint', () => {
  it('stable across calls', () => {
    const sub = { endpoint: 'https://push.example.com/abc/def' };
    expect(subscriptionFingerprint(sub)).toBe(subscriptionFingerprint(sub));
  });

  it('differs for different endpoints', () => {
    const a = subscriptionFingerprint({ endpoint: 'https://push.example.com/a' });
    const b = subscriptionFingerprint({ endpoint: 'https://push.example.com/b' });
    expect(a).not.toBe(b);
  });

  it('produces base64url-shaped output', () => {
    const fp = subscriptionFingerprint({ endpoint: 'https://x' });
    expect(fp).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fp.length).toBeLessThanOrEqual(32);
  });
});
