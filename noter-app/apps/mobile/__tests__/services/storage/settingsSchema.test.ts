import { parseSettings, parseSettingsJson, DEFAULT_SETTINGS } from '../../../services/storage/settingsSchema';

describe('parseSettings', () => {
  it('returns defaults for null/undefined/empty', () => {
    expect(parseSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not-an-object').settings).toEqual(DEFAULT_SETTINGS);
  });

  it('marks healed=true when defaults were substituted', () => {
    const { healed } = parseSettings(null);
    expect(healed).toBe(true);
  });

  it('preserves valid fields', () => {
    const { settings } = parseSettings({ theme: 'dark', notificationsEnabled: false });
    expect(settings.theme).toBe('dark');
    expect(settings.notificationsEnabled).toBe(false);
  });

  it('drops invalid field values and heals back to default', () => {
    const { settings, healed } = parseSettings({
      theme: 'rainbow',                       // invalid enum → drop, default to 'system'
      notificationsEnabled: 'yes',            // wrong type → drop
      notesSortBy: 'createdAt',               // valid → keep
    });
    expect(settings.theme).toBe('system');
    expect(settings.notificationsEnabled).toBe(true);
    expect(settings.notesSortBy).toBe('createdAt');
    expect(healed).toBe(true);
  });

  it('keeps optional apiUrl when a URL', () => {
    const { settings } = parseSettings({ apiUrl: 'https://api.example.com' });
    expect(settings.apiUrl).toBe('https://api.example.com');
  });

  it('strips invalid apiUrl', () => {
    const { settings } = parseSettings({ apiUrl: 'not a url' });
    expect(settings.apiUrl).toBeUndefined();
  });

  it('records and reads aiSystemPrompts map', () => {
    const { settings } = parseSettings({
      aiSystemPrompts: { 'global': 'be concise' },
    });
    expect(settings.aiSystemPrompts).toEqual({ global: 'be concise' });
  });

  it('caps prompt length at 8000 chars (rejected on overflow)', () => {
    const huge = 'x'.repeat(10000);
    const { settings } = parseSettings({ aiSystemPrompts: { 'global': huge } });
    // The whole map is dropped (zod's record validates each value) — default empty map.
    expect(settings.aiSystemPrompts).toEqual({});
  });
});

describe('parseSettingsJson', () => {
  it('handles null/empty inputs', () => {
    expect(parseSettingsJson(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettingsJson(undefined).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettingsJson('').settings).toEqual(DEFAULT_SETTINGS);
  });

  it('parses valid JSON', () => {
    const { settings } = parseSettingsJson(JSON.stringify({ theme: 'dark' }));
    expect(settings.theme).toBe('dark');
  });

  it('heals on corrupt JSON', () => {
    const { settings, healed } = parseSettingsJson('{ broken json');
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(healed).toBe(true);
  });
});
