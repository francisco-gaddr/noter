const { validateWindowState, captureWindowState, DEFAULTS } = require('../src/windowState');

const display = (workArea) => ({ workArea });
const primary = display({ x: 0, y: 0, width: 1920, height: 1080 });
const secondary = display({ x: 1920, y: 0, width: 1280, height: 720 });

describe('validateWindowState', () => {
  it('returns defaults for falsy / non-object input', () => {
    expect(validateWindowState(null, [primary])).toEqual({ ...DEFAULTS });
    expect(validateWindowState(undefined, [primary])).toEqual({ ...DEFAULTS });
    expect(validateWindowState('not-an-object', [primary])).toEqual({ ...DEFAULTS });
  });

  it('returns defaults when width/height are missing or non-finite', () => {
    expect(validateWindowState({}, [primary])).toEqual({ ...DEFAULTS });
    expect(validateWindowState({ width: 'NaN', height: 'NaN' }, [primary])).toEqual({ ...DEFAULTS });
  });

  it('rejects unreasonable sizes (too small / too large)', () => {
    expect(validateWindowState({ width: 50, height: 50 }, [primary])).toEqual({ ...DEFAULTS });
    expect(validateWindowState({ width: 9999, height: 9999 }, [primary])).toEqual({ ...DEFAULTS });
  });

  it('preserves valid size with no position', () => {
    const out = validateWindowState({ width: 1024, height: 768 }, [primary]);
    expect(out.width).toBe(1024);
    expect(out.height).toBe(768);
    expect(out.x).toBeUndefined();
    expect(out.y).toBeUndefined();
  });

  it('preserves position when it fits the primary display', () => {
    const out = validateWindowState({ width: 800, height: 600, x: 100, y: 100 }, [primary]);
    expect(out.x).toBe(100);
    expect(out.y).toBe(100);
  });

  it('preserves position when it fits a secondary display', () => {
    const out = validateWindowState({ width: 800, height: 600, x: 2000, y: 100 }, [primary, secondary]);
    expect(out.x).toBe(2000);
  });

  it('drops position when off all displays (e.g., external monitor unplugged)', () => {
    const out = validateWindowState({ width: 800, height: 600, x: 9999, y: 9999 }, [primary]);
    expect(out.x).toBeUndefined();
    expect(out.y).toBeUndefined();
    // Size is still preserved
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });

  it('carries isMaximized flag through', () => {
    const out = validateWindowState({ width: 1024, height: 768, isMaximized: true }, [primary]);
    expect(out.isMaximized).toBe(true);
  });
});

describe('captureWindowState', () => {
  const makeWin = (bounds, isMaximized = false) => ({
    isDestroyed: () => false,
    getNormalBounds: () => bounds,
    getBounds: () => bounds,
    isMaximized: () => isMaximized,
  });

  it('returns null for destroyed window', () => {
    expect(captureWindowState({ isDestroyed: () => true })).toBeNull();
  });

  it('returns null when no window passed', () => {
    expect(captureWindowState(null)).toBeNull();
  });

  it('extracts bounds and maximized state', () => {
    const win = makeWin({ x: 10, y: 20, width: 1024, height: 768 }, true);
    expect(captureWindowState(win)).toEqual({
      x: 10, y: 20, width: 1024, height: 768, isMaximized: true,
    });
  });
});
