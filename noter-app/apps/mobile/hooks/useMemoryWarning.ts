import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform, NativeEventEmitter } from 'react-native';

/**
 * Subscribe to OS memory-pressure events and run a cleanup callback.
 *
 * iOS: `memoryWarning` event on the global event emitter, fired by
 * UIApplicationDidReceiveMemoryWarningNotification.
 * Android: same `memoryWarning` event name, dispatched via the native
 * onTrimMemory bridge (level >= TRIM_MEMORY_RUNNING_MODERATE).
 *
 * Throttled to once per 5s so a stream of warnings (rare but possible
 * during scroll-heavy sessions on low-RAM devices) doesn't trigger a
 * cascade of cleanup work that itself causes jank.
 */

const THROTTLE_MS = 5_000;

export interface MemoryWarningOptions {
  throttleMs?: number;
}

export const useMemoryWarning = (
  onWarning: () => void | Promise<void>,
  opts: MemoryWarningOptions = {},
): void => {
  const throttleMs = opts.throttleMs ?? THROTTLE_MS;
  const lastFiredRef = useRef(0);
  const callbackRef = useRef(onWarning);
  callbackRef.current = onWarning;

  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (now - lastFiredRef.current < throttleMs) return;
      lastFiredRef.current = now;
      try {
        const result = callbackRef.current();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch(() => undefined);
        }
      } catch { /* swallow — cleanup must not throw */ }
    };

    // The event name is consistent across iOS/Android in React Native core.
    // Some Expo modules expose memory pressure via NativeEventEmitter; we
    // subscribe to both paths to be conservative.
    const sub = DeviceEventEmitter.addListener('memoryWarning', handler);
    let nativeSub: { remove: () => void } | null = null;
    try {
      // Some platforms expose an explicit NativeEventEmitter for the App
      // module; subscribing both is harmless because the throttle suppresses
      // duplicates.
      const emitter = new NativeEventEmitter();
      nativeSub = emitter.addListener('memoryWarning', handler);
    } catch {
      // older RN or unsupported platform
    }

    return () => {
      sub.remove();
      try { nativeSub?.remove(); } catch { /* noop */ }
    };
  }, [throttleMs]);
};

// Pure helper exposed for unit tests. `lastFiredAt = 0` means "never fired",
// which always allows; otherwise we enforce a sliding throttle window.
export const _shouldFire = (lastFiredAt: number, now: number, throttleMs: number): boolean => {
  if (lastFiredAt === 0) return true;
  return now - lastFiredAt >= throttleMs;
};
