import { useCallback, useRef, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Biometric (or passcode) unlock for sensitive screens.
 *
 * Wraps `expo-local-authentication` with:
 *   - Capability probe so callers can branch on "device has no biometrics".
 *   - Retry counter (5 attempts) with lockout window — once exhausted, we
 *     refuse further attempts for `lockoutMs` so a snooping bystander
 *     can't brute-force a stolen device.
 *   - Reason-localised prompt strings (caller passes the key, we ask the
 *     i18n layer).
 *
 * Returned `unlock()` resolves to:
 *   - { ok: true, method: 'biometric' | 'passcode' }
 *   - { ok: false, reason: 'cancelled' | 'failed' | 'unavailable' | 'locked-out' }
 *
 * Stateful (per-component instance): the retry counter resets when the
 * component unmounts. Callers that need a *global* lockout should plumb
 * a shared store, but for per-note unlock the per-mount semantics are
 * what users expect ("you tried 5 times, take a breath, then try again").
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 30_000;

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
  /** Which auth types are supported (face, fingerprint, etc.). */
  supportedTypes: number[];
}

export interface UnlockOptions {
  /** Prompt shown to the user. */
  promptMessage?: string;
  /** Fallback button label (e.g. "Use Passcode"). */
  fallbackLabel?: string;
  /** Cancel button label. */
  cancelLabel?: string;
}

export type UnlockResult =
  | { ok: true; method: 'biometric' | 'passcode' }
  | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' | 'locked-out' };

export interface UseBiometricLockOptions {
  maxAttempts?: number;
  lockoutMs?: number;
}

export const useBiometricLock = (opts: UseBiometricLockOptions = {}) => {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const lockoutMs = opts.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const lockoutUntilRef = useRef<number>(0);

  const probeCapability = useCallback(async (): Promise<BiometricCapability> => {
    try {
      const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      return {
        hasHardware: Boolean(hasHardware),
        isEnrolled: Boolean(isEnrolled),
        supportedTypes: Array.isArray(supportedTypes) ? supportedTypes : [],
      };
    } catch {
      return { hasHardware: false, isEnrolled: false, supportedTypes: [] };
    }
  }, []);

  const unlock = useCallback(async (unlockOpts: UnlockOptions = {}): Promise<UnlockResult> => {
    if (locked && Date.now() < lockoutUntilRef.current) {
      return { ok: false, reason: 'locked-out' };
    }
    const cap = await probeCapability();
    if (!cap.hasHardware || !cap.isEnrolled) {
      return { ok: false, reason: 'unavailable' };
    }
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: unlockOpts.promptMessage ?? 'Authenticate',
        fallbackLabel: unlockOpts.fallbackLabel,
        cancelLabel: unlockOpts.cancelLabel,
        disableDeviceFallback: false,
      });
      if (result.success) {
        setAttempts(0);
        setLocked(false);
        return { ok: true, method: 'biometric' };
      }
      const next = attempts + 1;
      setAttempts(next);
      if (next >= maxAttempts) {
        setLocked(true);
        lockoutUntilRef.current = Date.now() + lockoutMs;
      }
      const reason = result.error === 'user_cancel' || result.error === 'system_cancel'
        ? 'cancelled' as const
        : 'failed' as const;
      return { ok: false, reason };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }, [attempts, maxAttempts, lockoutMs, locked, probeCapability]);

  const reset = useCallback(() => {
    setAttempts(0);
    setLocked(false);
    lockoutUntilRef.current = 0;
  }, []);

  return {
    unlock,
    reset,
    probeCapability,
    attempts,
    locked,
    lockoutUntilMs: lockoutUntilRef.current,
  };
};
