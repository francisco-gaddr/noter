import { createErrorReporter, type ErrorReporter } from '@repo/shared';
import logger from './logger';

/**
 * Backend error tracking → self-hosted GlitchTip (Sentry-compatible), via the shared envelope reporter.
 * Disabled (no-op) unless GLITCHTIP_DSN is set, so it costs nothing by default. The reporter scrubs
 * sensitive context before send; we additionally never pass request bodies/headers here — only route,
 * status, requestId and the opaque actor id — so note content / tokens never reach the monitor.
 */
let reporter: ErrorReporter | null = null;

export const getErrorReporter = (): ErrorReporter => {
  if (!reporter) {
    reporter = createErrorReporter({
      dsn: process.env.GLITCHTIP_DSN || null,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.BUILD_ID || process.env.GIT_SHA || undefined,
      platform: 'node',
      serverName: process.env.HOSTNAME || undefined,
    });
  }
  return reporter;
};

let installed = false;

/** Install process-level crash reporting. Idempotent; safe to call when disabled. */
export const initErrorTracking = (): void => {
  const r = getErrorReporter();
  if (!r.enabled) { logger.info('error-tracking: disabled (set GLITCHTIP_DSN to enable)'); return; }
  if (installed) return;
  installed = true;
  logger.info('error-tracking: enabled (GlitchTip)');

  // Previously the process had NO unhandledRejection handler → node would crash on a stray rejected
  // promise. Capturing + logging (without exiting) is both more resilient AND now observable.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { message: (reason as Error)?.message });
    void r.captureException(reason, { level: 'error', tags: { handler: 'unhandledRejection' } });
  });

  // For a genuinely uncaught exception the process IS corrupted — record it, then preserve node's
  // default behaviour (exit) so we never linger in a bad state. The brief delay lets the POST flush.
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { message: err?.message, stack: err?.stack });
    void r.captureException(err, { level: 'fatal', tags: { handler: 'uncaughtException' } })
      .finally(() => { setTimeout(() => process.exit(1), 250); });
  });
};
