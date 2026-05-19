import { renderHook, act } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
}));

import * as Haptics from 'expo-haptics';
import { useRefreshControl } from '../../hooks/useRefreshControl';

describe('useRefreshControl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns refreshing=false initially', () => {
    const { result } = renderHook(() => useRefreshControl(async () => undefined, { minSpinMs: 50 }));
    expect(result.current.refreshing).toBe(false);
  });

  it('fires haptics on refresh', async () => {
    const { result } = renderHook(() => useRefreshControl(async () => undefined, { minSpinMs: 0 }));
    await act(async () => { await result.current.onRefresh(); });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('haptics can be disabled', async () => {
    const { result } = renderHook(() => useRefreshControl(async () => undefined, { haptic: false, minSpinMs: 0 }));
    await act(async () => { await result.current.onRefresh(); });
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('enforces minimum spin duration', async () => {
    const start = Date.now();
    const { result } = renderHook(() => useRefreshControl(async () => undefined, { haptic: false, minSpinMs: 100 }));
    await act(async () => { await result.current.onRefresh(); });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95); // small slack for timer precision
  });

  it('swallows refresh errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useRefreshControl(failing, { haptic: false, minSpinMs: 0 }));
    await act(async () => { await result.current.onRefresh(); });
    expect(failing).toHaveBeenCalled();
    expect(result.current.refreshing).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reentrancy guard: spam-pull does not queue multiple refreshes', async () => {
    let inFlight = 0;
    let peak = 0;
    const refreshFn = jest.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
    });
    const { result } = renderHook(() => useRefreshControl(refreshFn, { haptic: false, minSpinMs: 0 }));
    await act(async () => {
      // Fire three pulls — the 2nd and 3rd should be ignored while the first is in flight.
      const all = Promise.all([
        result.current.onRefresh(),
        result.current.onRefresh(),
        result.current.onRefresh(),
      ]);
      await all;
    });
    expect(peak).toBe(1);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });
});
