import { resolveReadPreference, getDefaultReadPreference } from '../../src/utils/readPreference';

describe('resolveReadPreference', () => {
  it('defaults to primary when env unset', () => {
    expect(resolveReadPreference(undefined)).toBe('primary');
    expect(resolveReadPreference('')).toBe('primary');
  });

  it('accepts each valid preference', () => {
    for (const p of ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']) {
      expect(resolveReadPreference(p)).toBe(p);
    }
  });

  it('warns and defaults to primary for unknown values', () => {
    expect(resolveReadPreference('local')).toBe('primary');
    expect(resolveReadPreference('any')).toBe('primary');
  });

  it('trims whitespace', () => {
    expect(resolveReadPreference('  secondary  ')).toBe('secondary');
  });
});

describe('getDefaultReadPreference', () => {
  it('returns one of the valid preferences', () => {
    const pref = getDefaultReadPreference();
    expect(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']).toContain(pref);
  });
});
