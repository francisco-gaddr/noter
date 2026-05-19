import { _resolveNetworkPolicy, _PRESETS } from '../../hooks/useNetworkPolicy';

describe('_resolveNetworkPolicy', () => {
  it('returns OFFLINE when state is null', () => {
    expect(_resolveNetworkPolicy(null)).toEqual(_PRESETS.OFFLINE);
  });

  it('returns OFFLINE when isConnected=false', () => {
    expect(_resolveNetworkPolicy({ isConnected: false } as any)).toEqual(_PRESETS.OFFLINE);
  });

  it('returns WIFI for wifi connections', () => {
    expect(_resolveNetworkPolicy({ isConnected: true, type: 'wifi', details: {} } as any)).toEqual(_PRESETS.WIFI);
  });

  it('returns WIFI for ethernet (treated same as wifi)', () => {
    expect(_resolveNetworkPolicy({ isConnected: true, type: 'ethernet', details: {} } as any)).toEqual(_PRESETS.WIFI);
  });

  it('returns CELLULAR for cellular connections', () => {
    expect(_resolveNetworkPolicy({ isConnected: true, type: 'cellular', details: {} } as any)).toEqual(_PRESETS.CELLULAR);
  });

  it('returns METERED when isConnectionExpensive=true (Low Data Mode / Data Saver)', () => {
    expect(_resolveNetworkPolicy({
      isConnected: true,
      type: 'wifi',
      details: { isConnectionExpensive: true },
    } as any)).toEqual(_PRESETS.METERED);
  });

  it('returns UNKNOWN for unrecognised connection types', () => {
    expect(_resolveNetworkPolicy({ isConnected: true, type: 'bluetooth', details: {} } as any)).toEqual(_PRESETS.UNKNOWN);
  });

  it('CELLULAR + WIFI have different sync intervals', () => {
    expect(_PRESETS.WIFI.syncIntervalMs).toBeLessThan(_PRESETS.CELLULAR.syncIntervalMs);
  });

  it('METERED defers large uploads but is online', () => {
    expect(_PRESETS.METERED.preferDeferLargeUploads).toBe(true);
    expect(_PRESETS.METERED.isOnline).toBe(true);
  });
});
