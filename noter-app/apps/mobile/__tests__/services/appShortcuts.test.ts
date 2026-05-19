import { isValidShortcutId, findShortcut, resolveShortcutActivation, getAppShortcuts } from '../../services/appShortcuts';

describe('isValidShortcutId', () => {
  it('accepts camelCase short ids', () => {
    expect(isValidShortcutId('newNote')).toBe(true);
    expect(isValidShortcutId('search')).toBe(true);
  });

  it('rejects non-string / empty / over-long / hyphens', () => {
    expect(isValidShortcutId('')).toBe(false);
    expect(isValidShortcutId('new-note')).toBe(false);
    expect(isValidShortcutId('a'.repeat(50))).toBe(false);
    // @ts-expect-error testing invalid input
    expect(isValidShortcutId(null)).toBe(false);
  });

  it('rejects ids starting with uppercase or digit', () => {
    expect(isValidShortcutId('NewNote')).toBe(false);
    expect(isValidShortcutId('1new')).toBe(false);
  });
});

describe('findShortcut', () => {
  it('returns the registered shortcut', () => {
    expect(findShortcut('newNote')?.title).toBe('New Note');
  });

  it('returns undefined for unknown id', () => {
    expect(findShortcut('totallyMadeUp')).toBeUndefined();
  });
});

describe('resolveShortcutActivation', () => {
  it('returns ok for known id', () => {
    const r = resolveShortcutActivation('search');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shortcut.route).toBe('/(tabs)/search');
  });

  it('rejects non-string input', () => {
    expect(resolveShortcutActivation(123).ok).toBe(false);
    expect(resolveShortcutActivation(null).ok).toBe(false);
  });

  it('rejects unknown id', () => {
    const r = resolveShortcutActivation('rogue');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-id');
  });

  it('rejects id with disallowed characters', () => {
    const r = resolveShortcutActivation('with space');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-id-format');
  });
});

describe('getAppShortcuts', () => {
  it('returns at least the canonical shortcuts', () => {
    const ids = getAppShortcuts().map((s) => s.id);
    expect(ids).toContain('newNote');
    expect(ids).toContain('search');
    expect(ids).toContain('lastNote');
    expect(ids).toContain('newTask');
  });

  it('every shortcut has a non-empty title + valid route', () => {
    for (const s of getAppShortcuts()) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.route).toMatch(/^\//);
    }
  });
});
