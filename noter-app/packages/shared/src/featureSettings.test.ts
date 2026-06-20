import { defaultFeatureSettings, parseFeatureSettings, serializeFeatureSettings } from './featureSettings';

describe('featureSettings', () => {
  it('defaults: every feature off, AI features have a default source/model config', () => {
    const d = defaultFeatureSettings();
    expect(d.autoLink.enabled).toBe(false);
    expect(d.flashcards.enabled).toBe(false);
    expect(d.flashcards.ai.source).toBe('api');
    expect(d.dailyReview.surfaceCount).toBe(5);
    expect(d.canvas.enabled).toBe(false);
  });

  it('round-trips through serialize/parse', () => {
    const s = defaultFeatureSettings();
    s.flashcards = { enabled: true, ai: { source: 'local', provider: 'mlc', model: 'phi-3' } };
    s.autoLink.enabled = true;
    expect(parseFeatureSettings(serializeFeatureSettings(s))).toEqual(s);
  });

  it('tolerantly merges a partial blob over defaults (forward-compat)', () => {
    const merged = parseFeatureSettings({ flashcards: { enabled: true } });
    expect(merged.flashcards.enabled).toBe(true);
    expect(merged.flashcards.ai.source).toBe('api'); // filled from default
    expect(merged.voice.enabled).toBe(false); // missing key → default
  });

  it('rejects junk + clamps surfaceCount', () => {
    expect(parseFeatureSettings('not json')).toEqual(defaultFeatureSettings());
    expect(parseFeatureSettings(null)).toEqual(defaultFeatureSettings());
    expect(parseFeatureSettings({ dailyReview: { surfaceCount: 999 } }).dailyReview.surfaceCount).toBe(50);
    expect(parseFeatureSettings({ flashcards: { ai: { source: 'bogus' } } }).flashcards.ai.source).toBe('api');
  });
});
