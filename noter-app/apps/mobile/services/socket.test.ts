jest.mock('./api', () => ({
  API_URL: 'http://10.0.2.2:3001/api'
}));

import { resolveSocketBaseUrl } from './socket';

describe('resolveSocketBaseUrl', () => {
  it('keeps http protocol and strips /api', () => {
    expect(resolveSocketBaseUrl('http://10.0.2.2:3001/api')).toBe('http://10.0.2.2:3001');
  });

  it('keeps https and strips /api', () => {
    expect(resolveSocketBaseUrl('https://api.example.com/api')).toBe('https://api.example.com');
  });

  it('falls back to daylited.com', () => {
    expect(resolveSocketBaseUrl()).toBe('https://daylited.com');
  });
});
