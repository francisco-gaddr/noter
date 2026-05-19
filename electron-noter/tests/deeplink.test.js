const { parseDeeplink, findDeeplinkInArgv } = require('../src/deeplink');

describe('parseDeeplink', () => {
  it('rejects non-string / empty / over-long inputs', () => {
    expect(parseDeeplink(null)).toBeNull();
    expect(parseDeeplink('')).toBeNull();
    expect(parseDeeplink('x'.repeat(2000))).toBeNull();
  });

  it('rejects non-noter:// protocols', () => {
    expect(parseDeeplink('https://daylited.com/')).toBeNull();
    expect(parseDeeplink('file:///etc/passwd')).toBeNull();
    expect(parseDeeplink('javascript:alert(1)')).toBeNull();
  });

  it('parses noter://note/<id>', () => {
    expect(parseDeeplink('noter://note/abc123')).toEqual({
      type: 'note',
      id: 'abc123',
      route: '/note/abc123',
    });
  });

  it('parses noter://task/<id>', () => {
    expect(parseDeeplink('noter://task/507f1f77bcf86cd799439011')).toEqual({
      type: 'task',
      id: '507f1f77bcf86cd799439011',
      route: '/task/507f1f77bcf86cd799439011',
    });
  });

  it('rejects ids containing unsafe characters', () => {
    // The URL parser normalises "../" path traversal away; whatever's left is
    // then validated strictly. We don't care that the result is "etc" — what
    // matters is that the traversal text never reaches the route.
    const trav = parseDeeplink('noter://note/abc/../etc/passwd');
    expect(trav?.id).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(trav?.route).not.toContain('..');
    expect(parseDeeplink('noter://note/a%20b')).toBeNull(); // space is not in allow-list
    expect(parseDeeplink('noter://note/<script>')).toBeNull();
  });

  it('rejects empty id', () => {
    expect(parseDeeplink('noter://note/')).toBeNull();
    expect(parseDeeplink('noter://note')).toBeNull();
  });

  it('parses noter://open?route=/foo', () => {
    expect(parseDeeplink('noter://open?route=/settings/profile')).toEqual({
      type: 'open',
      route: '/settings/profile',
    });
  });

  it('rejects open without route', () => {
    expect(parseDeeplink('noter://open')).toBeNull();
  });

  it('rejects open with absolute URL in route (no SSRF / external redirect)', () => {
    expect(parseDeeplink('noter://open?route=https://evil.com')).toBeNull();
    expect(parseDeeplink('noter://open?route=//evil.com')).toBeNull();
  });

  it('rejects unknown resource types', () => {
    expect(parseDeeplink('noter://admin/everything')).toBeNull();
  });
});

describe('findDeeplinkInArgv', () => {
  it('finds first valid deeplink in mixed argv', () => {
    const argv = ['/path/to/electron', '--some-flag', 'noter://note/abc123', '--other'];
    expect(findDeeplinkInArgv(argv)).toEqual({
      type: 'note',
      id: 'abc123',
      route: '/note/abc123',
    });
  });

  it('returns null for argv without any noter:// entry', () => {
    expect(findDeeplinkInArgv(['/usr/bin/electron', '--inspect'])).toBeNull();
  });

  it('skips invalid noter:// entries and finds the next valid one', () => {
    const argv = ['noter://admin/bad', 'noter://task/t1'];
    expect(findDeeplinkInArgv(argv)).toEqual({
      type: 'task',
      id: 't1',
      route: '/task/t1',
    });
  });

  it('rejects non-array input', () => {
    expect(findDeeplinkInArgv(null)).toBeNull();
    expect(findDeeplinkInArgv('noter://note/abc')).toBeNull();
  });
});
