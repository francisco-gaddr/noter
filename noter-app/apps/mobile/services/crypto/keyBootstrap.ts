/**
 * The key-bootstrap logic now lives in @repo/shared so the mobile and web adapters
 * share one tested implementation. This file re-exports it to keep existing mobile
 * import paths (and the dependency-injected adapter in ./index.ts) stable.
 */
export {
  KEY_VERSION,
  restoreFromDevice,
  enrollOrUnlock,
  recoverWithCode,
  changePassword,
  lockCrypto,
  type KeyBundle,
  type BootstrapDeps,
  type BootstrapResult,
  type EnrollOutcome,
} from '@repo/shared';
