import { _isRestorable } from '../../hooks/useRouteRestore';

describe('useRouteRestore — isRestorable', () => {
  it('accepts internal app routes', () => {
    expect(_isRestorable('/note/abc123')).toBe(true);
    expect(_isRestorable('/(tabs)/tasks')).toBe(true);
    expect(_isRestorable('/settings/profile')).toBe(true);
  });

  it('rejects root path', () => {
    expect(_isRestorable('/')).toBe(false);
  });

  it('rejects auth flows', () => {
    expect(_isRestorable('/auth/login')).toBe(false);
    expect(_isRestorable('/auth/register')).toBe(false);
  });

  it('rejects modal overlay routes', () => {
    expect(_isRestorable('/modal')).toBe(false);
  });

  it('rejects external-looking paths', () => {
    expect(_isRestorable('//evil.com/note/abc')).toBe(false);
    expect(_isRestorable('https://evil.com/note/abc')).toBe(false);
    expect(_isRestorable('javascript:alert(1)')).toBe(false);
  });

  it('rejects paths containing ..', () => {
    expect(_isRestorable('/note/../auth/login')).toBe(false);
  });

  it('rejects paths that do not start with /', () => {
    expect(_isRestorable('note/abc')).toBe(false);
    expect(_isRestorable('')).toBe(false);
  });

  it('rejects overly long paths', () => {
    expect(_isRestorable('/' + 'a'.repeat(300))).toBe(false);
  });

  it('rejects non-string', () => {
    // @ts-expect-error testing invalid input type
    expect(_isRestorable(null)).toBe(false);
    // @ts-expect-error testing invalid input type
    expect(_isRestorable(undefined)).toBe(false);
  });
});
