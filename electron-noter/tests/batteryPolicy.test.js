const { resolveBackgroundPolicy, intervalMultiplier, shouldSkipLargeJob } = require('../src/batteryPolicy');

describe('resolveBackgroundPolicy', () => {
  it('AC + nominal → normal', () => {
    const p = resolveBackgroundPolicy({ onBattery: false, thermalState: 'nominal' });
    expect(p.policy).toBe('normal');
    expect(p.reason).toBe('on-ac');
  });

  it('on battery + nominal → reduced (on-battery)', () => {
    const p = resolveBackgroundPolicy({ onBattery: true, thermalState: 'nominal' });
    expect(p.policy).toBe('reduced');
    expect(p.reason).toBe('on-battery');
  });

  it('on battery + fair → reduced (battery-and-warm)', () => {
    const p = resolveBackgroundPolicy({ onBattery: true, thermalState: 'fair' });
    expect(p.policy).toBe('reduced');
    expect(p.reason).toBe('battery-and-warm');
  });

  it('serious thermal → reduced regardless of battery', () => {
    expect(resolveBackgroundPolicy({ onBattery: false, thermalState: 'serious' }).policy).toBe('reduced');
    expect(resolveBackgroundPolicy({ onBattery: true, thermalState: 'serious' }).policy).toBe('reduced');
  });

  it('critical thermal → paused regardless of battery', () => {
    expect(resolveBackgroundPolicy({ onBattery: false, thermalState: 'critical' }).policy).toBe('paused');
    expect(resolveBackgroundPolicy({ onBattery: true, thermalState: 'critical' }).policy).toBe('paused');
  });

  it('unknown thermal state behaves like nominal', () => {
    const p = resolveBackgroundPolicy({ onBattery: false, thermalState: 'totally-unknown' });
    expect(p.policy).toBe('normal');
  });
});

describe('intervalMultiplier', () => {
  it('normal = 1x', () => {
    expect(intervalMultiplier('normal')).toBe(1);
  });

  it('reduced = 2x', () => {
    expect(intervalMultiplier('reduced')).toBe(2);
  });

  it('paused = Infinity', () => {
    expect(intervalMultiplier('paused')).toBe(Infinity);
  });
});

describe('shouldSkipLargeJob', () => {
  it('false for normal', () => {
    expect(shouldSkipLargeJob('normal')).toBe(false);
  });

  it('true for reduced + paused', () => {
    expect(shouldSkipLargeJob('reduced')).toBe(true);
    expect(shouldSkipLargeJob('paused')).toBe(true);
  });
});
