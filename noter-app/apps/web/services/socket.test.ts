import { resolveSocketBaseUrl } from './socket';

describe('resolveSocketBaseUrl', () => {
  it('converts http API URL to https and strips /api', () => {
    expect(resolveSocketBaseUrl({
      envUrl: 'http://example.com/api',
      origin: 'http://localhost:3000',
      isServer: false
    })).toBe('https://example.com');
  });

  it('uses window origin for relative API URL and enforces https', () => {
    expect(resolveSocketBaseUrl({
      envUrl: '/api',
      origin: 'http://app.local',
      isServer: false
    })).toBe('https://app.local');
  });

  it('falls back to window origin and enforces https', () => {
    expect(resolveSocketBaseUrl({
      envUrl: '',
      origin: 'http://fallback.local',
      isServer: false
    })).toBe('https://fallback.local');
  });
});
