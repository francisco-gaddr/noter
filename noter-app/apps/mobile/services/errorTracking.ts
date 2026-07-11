import { Alert } from 'react-native';
import { createErrorReporter, type ErrorReporter } from '@repo/shared';

/**
 * The SINGLE owner of the mobile global-error net — telemetry AND crash survival in one place.
 *
 * Why this file exists in this shape: React error boundaries catch RENDER errors, but NOT errors
 * thrown from async event handlers (e.g. the async chat send) or unhandled promise rejections. In a
 * release build those reach RN's default global handler, which CRASHES the app — the exact "app
 * crashes when chatting" report. Previously two competing installers fought over `setGlobalHandler`:
 * one chained back to the fatal default (re-crashing), the other swallowed but only ran in release.
 * The result was: dev/preview client → hard crash on any escaping error; release → survived but lost
 * all GlitchTip telemetry. This unifies them.
 *
 * Contract of the installed handler, in BOTH dev and release, WITH or WITHOUT a GlitchTip DSN:
 *   1. Report every escaping error/rejection to GlitchTip (only if a DSN is configured).
 *   2. DEV: chain to the previous handler so the red-box still shows real bugs.
 *   3. RELEASE: DO NOT chain to the fatal default — keep the app alive. Surface a brief, throttled
 *      alert for the first few so the user knows an action failed, then stay silent.
 *
 * Telemetry needs NO native module (POSTs over fetch), so it respects the no-native-SDK rule.
 * Native (truly fatal) crashes cannot be caught in JS — those are addressed at their source
 * (see the llama.rn model engine).
 */
let reporter: ErrorReporter | null = null;
let installed = false;
let survivalAlerts = 0;
const MAX_SURVIVAL_ALERTS = 3;

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__;

/** What the global handler should do for one error. Pure + exported so the crash-survival contract
 *  (RELEASE must NEVER chain to the fatal default) is unit-tested independently of RN globals. */
export interface ErrorNetAction {
  /** Always true — reporting is attempted; report() no-ops when no DSN is configured. */
  report: boolean;
  /** DEV only: chain to the previous handler (red-box) so real bugs stay visible. */
  chainRedbox: boolean;
  /** RELEASE only: keep the app alive (do NOT re-raise to the fatal default). */
  survive: boolean;
  /** RELEASE only: show a brief user notice (throttled). */
  alert: boolean;
}

export const decideErrorNetAction = (opts: {
  isFatal: boolean;
  isDev: boolean;
  alertsShown: number;
  maxAlerts: number;
}): ErrorNetAction => {
  if (opts.isDev) {
    return { report: true, chainRedbox: true, survive: false, alert: false };
  }
  // RELEASE: survive unconditionally; a throttled alert only for the first few.
  return { report: true, chainRedbox: false, survive: true, alert: opts.alertsShown < opts.maxAlerts };
};

export const getMobileErrorReporter = (): ErrorReporter => {
  if (!reporter) {
    reporter = createErrorReporter({
      dsn: process.env.EXPO_PUBLIC_GLITCHTIP_DSN || null,
      environment: isDev() ? 'development' : 'production',
      release: process.env.EXPO_PUBLIC_BUILD_ID || undefined,
      platform: 'react-native',
    });
  }
  return reporter;
};

const report = (error: unknown, tags: Record<string, string | boolean>, level: 'fatal' | 'error') => {
  const r = getMobileErrorReporter();
  if (!r.enabled) return;
  try {
    void r.captureException(error instanceof Error ? error : new Error(String((error as any)?.message ?? error)), {
      level,
      tags,
    });
  } catch {
    /* telemetry must never itself throw into the handler */
  }
};

/**
 * Install the global JS-error + promise-rejection net. Idempotent. Installs REGARDLESS of whether a
 * GlitchTip DSN is configured — crash survival must not depend on telemetry being enabled.
 */
export const initMobileErrorTracking = (): void => {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = global as any;

  // 1) Uncaught JS errors (including those surfaced from async handlers).
  const EU = g.ErrorUtils;
  if (EU && typeof EU.setGlobalHandler === 'function') {
    const prev = typeof EU.getGlobalHandler === 'function' ? EU.getGlobalHandler() : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    EU.setGlobalHandler((error: any, isFatal?: boolean) => {
      const action = decideErrorNetAction({
        isFatal: !!isFatal,
        isDev: isDev(),
        alertsShown: survivalAlerts,
        maxAlerts: MAX_SURVIVAL_ALERTS,
      });
      if (action.report) report(error, { source: 'ErrorUtils', fatal: !!isFatal }, isFatal ? 'fatal' : 'error');

      if (action.chainRedbox && typeof prev === 'function') {
        try { prev(error, isFatal); } catch { /* ignore */ }
        return;
      }
      // RELEASE: survive — deliberately NOT chaining to the default fatal handler (that crashes).
      try {
        // eslint-disable-next-line no-console
        console.error('[errorNet]', isFatal ? 'fatal(survived)' : 'error', error?.message, error);
      } catch { /* ignore */ }
      if (action.alert) {
        survivalAlerts += 1;
        try {
          Alert.alert('Något gick fel', 'En åtgärd misslyckades, men appen fortsätter köra. Försök igen.');
        } catch { /* ignore */ }
      }
    });
  }

  // 2) Unhandled promise rejections. Only ONE tracker can be active, so this is the single owner.
  //    Prefer the Hermes native hook; fall back to the promise polyfill's rejection-tracking.
  if (g.HermesInternal && typeof g.HermesInternal.enablePromiseRejectionTracker === 'function') {
    g.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUnhandled: (_id: number, rejection: any) => {
        report(rejection, { source: 'unhandledRejection' }, 'error');
      },
      onHandled: () => { /* noop */ },
    });
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tracking = require('promise/setimmediate/rejection-tracking');
      if (tracking && typeof tracking.enable === 'function') {
        tracking.enable({
          allRejections: true,
          onUnhandled: (_id: number, err: unknown) => report(err, { source: 'unhandledRejection' }, 'error'),
          onHandled: () => { /* noop */ },
        });
      }
    } catch { /* best-effort */ }
  }
};
