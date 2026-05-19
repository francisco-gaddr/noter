import { parseAppDeepLink } from '../../hooks/useDeepLinkConsumer';

describe('parseAppDeepLink — noter:// scheme', () => {
  it('parses noter://note/<id>', () => {
    expect(parseAppDeepLink('noter://note/abc123')).toEqual({
      type: 'note', id: 'abc123', route: '/note/abc123',
    });
  });

  it('parses noter://task/<id>', () => {
    expect(parseAppDeepLink('noter://task/507f1f77')).toEqual({
      type: 'task', id: '507f1f77', route: '/task/507f1f77',
    });
  });

  it('parses noter://open?route=/internal/path', () => {
    expect(parseAppDeepLink('noter://open?route=/settings/profile')).toEqual({
      type: 'open', route: '/settings/profile',
    });
  });

  it('rejects unknown noter:// hosts', () => {
    expect(parseAppDeepLink('noter://admin/everything')).toBeNull();
  });

  it('rejects open with absolute or protocol-relative route', () => {
    expect(parseAppDeepLink('noter://open?route=//evil.com')).toBeNull();
    expect(parseAppDeepLink('noter://open?route=https://evil.com')).toBeNull();
    expect(parseAppDeepLink('noter://open?route=../settings')).toBeNull();
  });

  it('rejects ids with unsafe characters', () => {
    expect(parseAppDeepLink('noter://note/<script>')).toBeNull();
    expect(parseAppDeepLink('noter://note/a%20b')).toBeNull();
  });
});

describe('parseAppDeepLink — https universal links', () => {
  it('accepts https://daylited.com/note/<id>', () => {
    const out = parseAppDeepLink('https://daylited.com/note/abc-123');
    expect(out).toEqual({ type: 'note', id: 'abc-123', route: '/note/abc-123' });
  });

  it('accepts the www. variant', () => {
    expect(parseAppDeepLink('https://www.daylited.com/task/t1')).toEqual({
      type: 'task', id: 't1', route: '/task/t1',
    });
  });

  it('rejects http:// (downgrade)', () => {
    expect(parseAppDeepLink('http://daylited.com/note/abc')).toBeNull();
  });

  it('rejects foreign hosts', () => {
    expect(parseAppDeepLink('https://evil.com/note/abc')).toBeNull();
  });

  it('rejects malformed paths', () => {
    expect(parseAppDeepLink('https://daylited.com/note/')).toBeNull();
    expect(parseAppDeepLink('https://daylited.com/random/abc')).toBeNull();
  });
});

describe('parseAppDeepLink — defensive', () => {
  it('rejects empty / non-string / over-long', () => {
    expect(parseAppDeepLink('')).toBeNull();
    // @ts-expect-error testing invalid input type
    expect(parseAppDeepLink(null)).toBeNull();
    expect(parseAppDeepLink('x'.repeat(2000))).toBeNull();
  });
});
