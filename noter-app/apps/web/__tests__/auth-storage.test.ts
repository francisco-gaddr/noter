import { getWebAuthTokenSync, getWebRefreshTokenSync, setWebAuthToken, setWebRefreshToken } from '../services/authStorage';

describe('authStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as any).mlc;
  });

  it('does not persist tokens in normal browser mode', () => {
    setWebAuthToken('secure-token');
    expect(getWebAuthTokenSync()).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('persists tokens only in electron mode', () => {
    (window as any).mlc = { isElectron: true };
    setWebAuthToken('secure-token');
    expect(sessionStorage.getItem('token')).toBe('secure-token');
    expect(sessionStorage.getItem('auth_token')).toBe('secure-token');
  });

  it('migrates legacy token from localStorage in electron mode', () => {
    (window as any).mlc = { isElectron: true };
    localStorage.setItem('token', 'legacy-token');
    const token = getWebAuthTokenSync();
    expect(token).toBe('legacy-token');
    expect(sessionStorage.getItem('token')).toBe('legacy-token');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears all token keys', () => {
    localStorage.setItem('token', 'x');
    localStorage.setItem('auth_token', 'x');
    sessionStorage.setItem('token', 'x');
    sessionStorage.setItem('auth_token', 'x');
    setWebAuthToken(null);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('auth_token')).toBeNull();
  });

  it('stores and migrates refresh tokens separately in electron mode', () => {
    (window as any).mlc = { isElectron: true };
    setWebRefreshToken('refresh-1');
    expect(sessionStorage.getItem('refresh_token')).toBe('refresh-1');
    expect(getWebRefreshTokenSync()).toBe('refresh-1');

    setWebRefreshToken(null);
    localStorage.setItem('refresh_token', 'legacy-refresh');
    expect(getWebRefreshTokenSync()).toBe('legacy-refresh');
    expect(sessionStorage.getItem('refresh_token')).toBe('legacy-refresh');
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });
});
