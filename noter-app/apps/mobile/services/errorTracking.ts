import { createErrorReporter, type ErrorReporter } from '@repo/shared';

/**
 * Mobile error tracking → self-hosted GlitchTip, via the SAME shared envelope reporter as the backend
 * and web. Crucially this needs NO native module (it POSTs over fetch), so it respects the hard
 * no-EAS-builds rule. No-op unless EXPO_PUBLIC_GLITCHTIP_DSN is set (inlined into the bundle at build
 * time). The reporter scrubs sensitive context before send — never note content, bodies or tokens.
 */
let reporter: ErrorReporter | null = null;
let installed = false;

export const getMobileErrorReporter = (): ErrorReporter => {
  if (!reporter) {
    reporter = createErrorReporter({
      dsn: process.env.EXPO_PUBLIC_GLITCHTIP_DSN || null,
      // eslint-disable-next-line no-undef
      environment: typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production',
      release: process.env.EXPO_PUBLIC_BUILD_ID || undefined,
      platform: 'react-native',
    });
  }
  return reporter;
};

/** Install RN global JS-error + Hermes promise-rejection handlers. Idempotent; preserves the previous
 *  global handler so the red-screen/crash behaviour is unchanged. */
export const initMobileErrorTracking = (): void => {
  const r = getMobileErrorReporter();
  if (!r.enabled || installed) return;
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = global as any;

  // Fatal + non-fatal JS errors. Chain the previous handler so nothing it did (red box, native crash
  // reporting) is lost.
  const EU = g.ErrorUtils;
  if (EU && typeof EU.getGlobalHandler === 'function' && typeof EU.setGlobalHandler === 'function') {
    const prev = EU.getGlobalHandler();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    EU.setGlobalHandler((error: any, isFatal?: boolean) => {
      void r.captureException(error, { level: isFatal ? 'fatal' : 'error', tags: { source: 'ErrorUtils', fatal: !!isFatal } });
      if (typeof prev === 'function') prev(error, isFatal);
    });
  }

  // Unhandled promise rejections — Hermes exposes a native tracker hook (only one tracker can be
  // active, so this is the single owner). Best-effort: absent on JSC/web.
  if (g.HermesInternal && typeof g.HermesInternal.enablePromiseRejectionTracker === 'function') {
    g.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUnhandled: (_id: number, rejection: any) => {
        void r.captureException(rejection instanceof Error ? rejection : new Error(String(rejection)), { level: 'error', tags: { source: 'unhandledRejection' } });
      },
    });
  }
};
