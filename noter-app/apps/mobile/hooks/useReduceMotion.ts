import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Subscribe to the OS reduce-motion preference. We honour this everywhere we
 * play layout/entrance animations so the experience is comfortable for users
 * with vestibular sensitivities.
 *
 * Initial value is conservative (`false`) until we know — false means
 * animations play; we'd rather flash once than refuse to animate for users
 * who don't have the pref set.
 */
export const useReduceMotion = (): boolean => {
  const [reduce, setReduce] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduce(Boolean(v)); }).catch(() => { /* noop */ });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { setReduce(Boolean(v)); });
    return () => {
      mounted = false;
      // RN >= 0.65 sub is an EventSubscription with remove()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sub as any)?.remove?.();
    };
  }, []);

  return reduce;
};
