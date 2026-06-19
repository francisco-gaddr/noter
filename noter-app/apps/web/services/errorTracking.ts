import { createErrorReporter, type ErrorReporter } from '@repo/shared';

/**
 * Web error tracking → self-hosted GlitchTip, via the SAME shared envelope reporter as the backend
 * and mobile (no @sentry/nextjs build-wrapping, no new dependency). No-op unless
 * NEXT_PUBLIC_GLITCHTIP_DSN is set. The reporter scrubs sensitive context before send; we only attach
 * a coarse source tag here — never note content, request bodies or tokens.
 *
 * NEXT_PUBLIC_* is inlined at build time, so the DSN must be present when `next build` runs (see
 * Doc/ops/error-tracking-glitchtip.md). Changing it requires a web rebuild.
 */
let reporter: ErrorReporter | null = null;
let installed = false;

export const getWebErrorReporter = (): ErrorReporter => {
  if (!reporter) {
    reporter = createErrorReporter({
      dsn: process.env.NEXT_PUBLIC_GLITCHTIP_DSN || null,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.NEXT_PUBLIC_BUILD_ID || undefined,
      platform: 'javascript',
    });
  }
  return reporter;
};

/** Install global handlers for uncaught errors + unhandled promise rejections. Browser-only, idempotent. */
export const initWebErrorTracking = (): void => {
  if (typeof window === 'undefined') return;
  const r = getWebErrorReporter();
  if (!r.enabled || installed) return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    void r.captureException(e.error || new Error(e.message), { level: 'error', tags: { source: 'window.onerror' } });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    void r.captureException(reason instanceof Error ? reason : new Error(String(reason)), { level: 'error', tags: { source: 'unhandledrejection' } });
  });
};
