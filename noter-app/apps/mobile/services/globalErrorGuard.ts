/**
 * Last-resort global JS error net. React error boundaries catch render errors, but NOT
 * errors thrown in async event handlers (e.g. an async send/search onPress) or unhandled
 * promise rejections — in a release build those reach RN's default global handler which
 * CRASHES the app. The user has repeatedly hit hard crashes when chatting / searching models,
 * so we install a handler that logs the error and keeps the app alive (shows a brief alert for
 * the first few, then stays silent) instead of crashing.
 *
 * This is a safety NET, not a substitute for guarding handlers — but it converts "app dies"
 * into "app survives, one action failed". Native (truly fatal) crashes can't be caught in JS.
 */
import { Alert } from 'react-native';

let installed = false;
let shownCount = 0;
const MAX_ALERTS = 3;

export const installGlobalErrorGuard = (): void => {
  if (installed) return;
  installed = true;
  // Only act in RELEASE builds. In dev / Expo Go we want the normal red-box and must not
  // touch the global handler (it can interfere with the dev launch flow).
  if (typeof __DEV__ !== 'undefined' && __DEV__) return;
  const g: any = global as any;

  // 1) Uncaught JS errors (incl. those surfaced from async handlers).
  try {
    const EU = g.ErrorUtils;
    if (EU && typeof EU.setGlobalHandler === 'function') {
      const prev = typeof EU.getGlobalHandler === 'function' ? EU.getGlobalHandler() : null;
      EU.setGlobalHandler((error: any, isFatal?: boolean) => {
        try {
          // eslint-disable-next-line no-console
          console.error('[globalErrorGuard]', isFatal ? 'fatal' : 'non-fatal', error?.message, error);
        } catch { /* ignore */ }
        // Keep the app alive. We deliberately do NOT chain to the default fatal handler,
        // which would crash the process — the whole point is to survive.
        if (shownCount < MAX_ALERTS) {
          shownCount += 1;
          try {
            Alert.alert('Något gick fel', 'En åtgärd misslyckades men appen fortsätter köra. Försök igen.');
          } catch { /* ignore */ }
        }
        // In DEV, still surface to the previous (red-box) handler so we see real bugs.
        if (__DEV__ && typeof prev === 'function') {
          try { prev(error, false); } catch { /* ignore */ }
        }
      });
    }
  } catch { /* ignore */ }

  // 2) Unhandled promise rejections (Hermes/RN rejection tracking).
  try {
    const tracking = require('promise/setimmediate/rejection-tracking');
    if (tracking && typeof tracking.enable === 'function') {
      tracking.enable({
        allRejections: true,
        onUnhandled: (_id: number, err: any) => {
          try { console.error('[globalErrorGuard] unhandled rejection', err?.message, err); } catch { /* ignore */ }
        },
        onHandled: () => { /* noop */ },
      });
    }
  } catch { /* ignore — best effort */ }
};
