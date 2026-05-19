const { SHORTCUTS, byId, acceleratorFor, labelFor, detectConflicts } = require('../src/shortcuts');

describe('shortcut registry', () => {
  it('exports a non-empty array of shortcuts', () => {
    expect(Array.isArray(SHORTCUTS)).toBe(true);
    expect(SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('every shortcut has id, label, scope, description', () => {
    for (const s of SHORTCUTS) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(['global', 'window']).toContain(s.scope);
      expect(typeof s.description).toBe('string');
    }
  });

  it('byId returns the shortcut record', () => {
    const s = byId('noter.find');
    expect(s).toBeDefined();
    expect(s.label).toBe('Find in Page…');
  });

  it('byId returns undefined for unknown id', () => {
    expect(byId('does.not.exist')).toBeUndefined();
  });

  it('acceleratorFor returns the accelerator string', () => {
    expect(acceleratorFor('noter.find')).toBe('CmdOrCtrl+F');
  });

  it('labelFor falls back to the id when shortcut is missing', () => {
    expect(labelFor('not.a.real.id')).toBe('not.a.real.id');
  });

  it('detects accelerator conflicts', () => {
    const conflicting = [
      { id: 'a', label: 'A', accelerator: 'CmdOrCtrl+F', scope: 'window', description: '' },
      { id: 'b', label: 'B', accelerator: 'CmdOrCtrl+F', scope: 'window', description: '' },
    ];
    const conflicts = detectConflicts(conflicting);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(['a', 'b']);
  });

  it('detects no conflicts when accelerators differ', () => {
    expect(detectConflicts([
      { id: 'a', accelerator: 'CmdOrCtrl+F' },
      { id: 'b', accelerator: 'CmdOrCtrl+G' },
    ])).toEqual([]);
  });

  it('shortcuts without accelerators do not collide', () => {
    expect(detectConflicts([
      { id: 'a', accelerator: undefined },
      { id: 'b', accelerator: undefined },
    ])).toEqual([]);
  });

  it('the shipped registry itself has no conflicts (smoke test for the throw)', () => {
    expect(detectConflicts(SHORTCUTS)).toEqual([]);
  });
});
