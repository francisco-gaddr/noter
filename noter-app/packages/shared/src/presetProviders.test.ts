import { getPresetCustomProviders, mergePresetProviders } from './presetProviders';

describe('preset providers (exclusive per user)', () => {
  it('returns the Hermes presets for princefranspadi (canonical) and the legacy alias', () => {
    for (const name of ['princefranspadi', 'prrincefranspadi']) {
      const presets = getPresetCustomProviders(name);
      expect(presets.map((p) => p.id)).toEqual(['preset-hermes-pi-ollama', 'preset-hermes-mac-lmstudio']);
      expect(presets[0].baseUrl).toBe('http://100.64.0.2:11434');
      expect(presets[1].baseUrl).toBe('http://192.168.50.10:1234');
    }
  });

  it('matches case-insensitively and via email local part', () => {
    expect(getPresetCustomProviders('PrinceFranspadi')).toHaveLength(2);
    expect(getPresetCustomProviders('princefranspadi@example.com')).toHaveLength(2);
  });

  it('returns nothing for any other user (not default for others)', () => {
    expect(getPresetCustomProviders('someoneelse')).toEqual([]);
    expect(getPresetCustomProviders('')).toEqual([]);
    expect(getPresetCustomProviders(undefined)).toEqual([]);
    expect(getPresetCustomProviders(null)).toEqual([]);
  });

  it('merges only the missing presets and reports added=false when nothing changes', () => {
    const first = mergePresetProviders([], 'prrincefranspadi');
    expect(first.added).toBe(true);
    expect(first.merged).toHaveLength(2);

    const second = mergePresetProviders(first.merged, 'prrincefranspadi');
    expect(second.added).toBe(false);
    expect(second.merged).toBe(first.merged); // same reference, no needless re-save
  });

  it('preserves user edits to a preset (existing id wins, not re-added)', () => {
    const edited = [{ id: 'preset-hermes-pi-ollama', label: 'My Pi', baseUrl: 'http://x', model: 'm', apiKey: '' }];
    const { merged, added } = mergePresetProviders(edited, 'prrincefranspadi');
    expect(added).toBe(true); // the Mac one is still added
    expect(merged.find((p) => p.id === 'preset-hermes-pi-ollama')!.label).toBe('My Pi');
    expect(merged).toHaveLength(2);
  });

  it('does not inject presets for other users', () => {
    const { merged, added } = mergePresetProviders([], 'bob');
    expect(added).toBe(false);
    expect(merged).toEqual([]);
  });
});
