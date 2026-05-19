import { _shouldFire } from '../../hooks/useMemoryWarning';

describe('useMemoryWarning — throttle gate', () => {
  it('fires on first event', () => {
    expect(_shouldFire(0, 1000, 5000)).toBe(true);
  });

  it('suppresses repeat within throttle window', () => {
    expect(_shouldFire(1000, 1500, 5000)).toBe(false);
    expect(_shouldFire(1000, 4999, 5000)).toBe(false);
  });

  it('fires again after the throttle window', () => {
    expect(_shouldFire(1000, 6000, 5000)).toBe(true);
    expect(_shouldFire(1000, 10_000, 5000)).toBe(true);
  });

  it('exactly-at-the-boundary fires (>=)', () => {
    expect(_shouldFire(1000, 6000, 5000)).toBe(true);
  });
});
