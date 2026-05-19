const { buildNoteWindowOptions, ID_PATTERN } = require('../src/noteWindow');

describe('buildNoteWindowOptions', () => {
  it('returns ok:false for invalid id', () => {
    expect(buildNoteWindowOptions('').ok).toBe(false);
    expect(buildNoteWindowOptions('a b').ok).toBe(false);
    expect(buildNoteWindowOptions('a\nb').ok).toBe(false);
    expect(buildNoteWindowOptions('x'.repeat(200)).ok).toBe(false);
  });

  it('returns options + deeplink for valid id', () => {
    const r = buildNoteWindowOptions('note-abc-123');
    expect(r.ok).toBe(true);
    expect(r.options.width).toBe(900);
    expect(r.options.height).toBe(700);
    expect(r.options.show).toBe(false);
    expect(r.deeplink).toBe('/note/note-abc-123');
  });

  it('enables devTools only in dev', () => {
    expect(buildNoteWindowOptions('id', { isDev: true }).options.webPreferences.devTools).toBe(true);
    expect(buildNoteWindowOptions('id', { isDev: false }).options.webPreferences.devTools).toBe(false);
  });

  it('uses provided preload path', () => {
    const r = buildNoteWindowOptions('id', { preloadPath: '/custom/preload.js' });
    expect(r.options.webPreferences.preload).toBe('/custom/preload.js');
  });

  it('contextIsolation always on, nodeIntegration always off', () => {
    const r = buildNoteWindowOptions('id');
    expect(r.options.webPreferences.contextIsolation).toBe(true);
    expect(r.options.webPreferences.nodeIntegration).toBe(false);
  });

  it('ID_PATTERN accepts safe ids and rejects unsafe ones', () => {
    expect(ID_PATTERN.test('abc-123')).toBe(true);
    expect(ID_PATTERN.test('507f1f77bcf86cd799439011')).toBe(true);
    expect(ID_PATTERN.test('a b')).toBe(false);
    expect(ID_PATTERN.test('../etc/passwd')).toBe(false);
  });
});
