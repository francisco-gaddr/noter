/**
 * DEPRECATED as a separate mechanism — kept only as a stable alias so existing call sites keep
 * working. The global JS-error + promise-rejection net (telemetry + crash survival) is now owned in
 * ONE place: `initMobileErrorTracking` in ./errorTracking. Having two installers race over
 * `ErrorUtils.setGlobalHandler` was itself part of the bug — one chained back to RN's fatal default
 * and re-crashed the app, the other only ran in release. This just forwards; the owner is idempotent.
 */
import { initMobileErrorTracking } from './errorTracking';

export const installGlobalErrorGuard = (): void => {
  initMobileErrorTracking();
};
