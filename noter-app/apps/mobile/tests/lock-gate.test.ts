import { canNavigateToSensitiveRoute } from '../utils/lockGate';

describe('lockGate', () => {
  it('denies navigation when app is locked', () => {
    expect(canNavigateToSensitiveRoute({
      isLocked: true,
      checking: false,
      hasToken: true,
      isInitialized: true,
    })).toBe(false);
  });

  it('denies navigation before initialization', () => {
    expect(canNavigateToSensitiveRoute({
      isLocked: false,
      checking: false,
      hasToken: true,
      isInitialized: false,
    })).toBe(false);
  });

  it('allows navigation only when unlocked and authenticated', () => {
    expect(canNavigateToSensitiveRoute({
      isLocked: false,
      checking: false,
      hasToken: true,
      isInitialized: true,
    })).toBe(true);
  });
});
