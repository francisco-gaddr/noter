const { resolveVibrancyForTheme, isValidVibrancyMaterial } = require('../src/vibrancy');

describe('resolveVibrancyForTheme', () => {
  it('returns null on non-darwin platforms', () => {
    expect(resolveVibrancyForTheme('dark', 'win32')).toBeNull();
    expect(resolveVibrancyForTheme('light', 'linux')).toBeNull();
  });

  it('picks "dark" for dark theme on darwin', () => {
    expect(resolveVibrancyForTheme('dark', 'darwin')).toBe('dark');
  });

  it('picks "sidebar" for light theme on darwin', () => {
    expect(resolveVibrancyForTheme('light', 'darwin')).toBe('sidebar');
  });

  it('uses current process.platform as default', () => {
    // Just verify it returns something callable — the actual value depends on host.
    expect(() => resolveVibrancyForTheme('dark')).not.toThrow();
  });
});

describe('isValidVibrancyMaterial', () => {
  it('accepts canonical materials', () => {
    expect(isValidVibrancyMaterial('dark')).toBe(true);
    expect(isValidVibrancyMaterial('sidebar')).toBe(true);
    expect(isValidVibrancyMaterial('titlebar')).toBe(true);
  });

  it('rejects unknown materials', () => {
    expect(isValidVibrancyMaterial('rainbow')).toBe(false);
    expect(isValidVibrancyMaterial('')).toBe(false);
    expect(isValidVibrancyMaterial(null)).toBe(false);
  });
});
