import { resolveSocketBaseUrl } from './socket';

describe('resolveSocketBaseUrl', () => {
  it('converts http API URL to ws and strips /api', () => {
    expect(resolveSocketBaseUrl({
      apiBaseUrl: 'http://example.com/api',
      origin: 'http://localhost:3000',
      isServer: false
    })).toBe('ws://example.com');
  });

  it('converts https API URL to wss and strips /api', () => {
    expect(resolveSocketBaseUrl({
      apiBaseUrl: 'https://example.com/api',
      origin: 'http://localhost:3000',
      isServer: false
    })).toBe('wss://example.com');
  });

  it('uses window origin for relative API URL and maps to ws', () => {
    expect(resolveSocketBaseUrl({
      apiBaseUrl: '/api',
      origin: 'http://app.local',
      isServer: false
    })).toBe('ws://app.local');
  });

  it('falls back to window origin and maps to ws', () => {
    expect(resolveSocketBaseUrl({
      apiBaseUrl: '',
      origin: 'http://fallback.local',
      isServer: false
    })).toBe('ws://fallback.local');
  });
});
