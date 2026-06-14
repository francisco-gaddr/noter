import { isPrivateSocketHost, enforceSecureSocketUrl } from './socketSecurity';

describe('isPrivateSocketHost', () => {
  it('treats loopback / LAN / mDNS / tailnet as private', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', 'mac.local', '10.0.0.5', '192.168.50.16', '172.16.0.1', '172.31.255.255', '100.64.0.2', '100.127.9.9', '192.168.50.16:3001']) {
      expect(isPrivateSocketHost(h)).toBe(true);
    }
  });
  it('treats public domains / IPs as public', () => {
    for (const h of ['daylited.com', 'noter.gaddr.tech', '8.8.8.8', '172.15.0.1', '100.63.0.1', '100.128.0.1', 'example.com:443']) {
      expect(isPrivateSocketHost(h)).toBe(false);
    }
  });
});

describe('enforceSecureSocketUrl', () => {
  it('upgrades ws→wss and http→https for public hosts', () => {
    expect(enforceSecureSocketUrl('ws://daylited.com')).toBe('wss://daylited.com');
    expect(enforceSecureSocketUrl('http://noter.gaddr.tech')).toBe('https://noter.gaddr.tech');
    expect(enforceSecureSocketUrl('ws://example.com/socket.io')).toBe('wss://example.com/socket.io');
  });
  it('leaves private/LAN/tailnet hosts unchanged (dev keeps working)', () => {
    expect(enforceSecureSocketUrl('http://localhost:3001')).toBe('http://localhost:3001');
    expect(enforceSecureSocketUrl('ws://192.168.50.16:3001')).toBe('ws://192.168.50.16:3001');
    expect(enforceSecureSocketUrl('http://100.64.0.2:3001')).toBe('http://100.64.0.2:3001');
  });
  it('already-secure URLs are preserved', () => {
    expect(enforceSecureSocketUrl('wss://daylited.com')).toBe('wss://daylited.com');
    expect(enforceSecureSocketUrl('https://daylited.com')).toBe('https://daylited.com');
  });
  it('upgrades a bare public host and leaves bare private host', () => {
    expect(enforceSecureSocketUrl('daylited.com')).toBe('wss://daylited.com');
    expect(enforceSecureSocketUrl('localhost')).toBe('localhost');
  });
  it('handles empty input', () => {
    expect(enforceSecureSocketUrl('')).toBe('');
  });
});
