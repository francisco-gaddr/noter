import { _qualityForPolicy, _qualityPresets } from '../../hooks/useImageQuality';

describe('image quality presets', () => {
  it('wifi → high / 2048 / 92', () => {
    expect(_qualityForPolicy('wifi')).toEqual({ quality: 'high', maxWidth: 2048, uploadQuality: 92 });
  });

  it('cellular → medium / 1024 / 78', () => {
    expect(_qualityForPolicy('cellular')).toEqual({ quality: 'medium', maxWidth: 1024, uploadQuality: 78 });
  });

  it('metered → low / 640 / 60', () => {
    expect(_qualityForPolicy('metered')).toEqual({ quality: 'low', maxWidth: 640, uploadQuality: 60 });
  });

  it('offline → low (so we still have a value to use for placeholders)', () => {
    expect(_qualityForPolicy('offline').quality).toBe('low');
  });

  it('unknown → medium (conservative)', () => {
    expect(_qualityForPolicy('unknown').quality).toBe('medium');
  });

  it('wifi has higher maxWidth than cellular', () => {
    expect(_qualityPresets.wifi.maxWidth).toBeGreaterThan(_qualityPresets.cellular.maxWidth);
  });

  it('wifi has higher uploadQuality than metered', () => {
    expect(_qualityPresets.wifi.uploadQuality).toBeGreaterThan(_qualityPresets.metered.uploadQuality);
  });

  it('every preset has uploadQuality between 0 and 100', () => {
    for (const p of Object.values(_qualityPresets)) {
      expect(p.uploadQuality).toBeGreaterThan(0);
      expect(p.uploadQuality).toBeLessThanOrEqual(100);
    }
  });
});
