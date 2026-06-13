import React, { useState, useEffect, useRef } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import { Button, Text, Surface, useTheme } from 'react-native-paper';
import { useBiometrics } from '@/hooks/useBiometrics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '@/stores/useStore';

interface AppLockProps {
  children: React.ReactNode;
}

type LockTiming = 'immediate' | '5min' | '15min' | '30min' | '1h' | '3h' | '6h' | '12h';

const LOCK_TIMING_KEY = 'lockTiming';
const LAST_BACKGROUND_KEY = 'lastBackgroundAt';

const HOUR_MS = 60 * 60 * 1000;

const LOCK_TIMINGS: readonly LockTiming[] = ['immediate', '5min', '15min', '30min', '1h', '3h', '6h', '12h'];

const isLockTiming = (v: unknown): v is LockTiming =>
  typeof v === 'string' && (LOCK_TIMINGS as readonly string[]).includes(v);

const lockTimingToMs = (timing: LockTiming) => {
  if (timing === 'immediate') return 0;
  if (timing === '5min') return 5 * 60 * 1000;
  if (timing === '15min') return 15 * 60 * 1000;
  if (timing === '30min') return 30 * 60 * 1000;
  if (timing === '1h') return HOUR_MS;
  if (timing === '3h') return 3 * HOUR_MS;
  if (timing === '6h') return 6 * HOUR_MS;
  if (timing === '12h') return 12 * HOUR_MS;
  return HOUR_MS;
};

// Sliding-window lockout: 5 failed prompts inside 60s → 30s cool-down.
// Pure helpers live in utils/biometricLockout.ts so the gate logic is
// unit-tested without an RN runtime.
import {
  recordFailure,
  isLockedOut as isLockedOutNow,
  lockoutSecondsRemaining as remainingSeconds,
  LOCKOUT_DURATION_MS,
} from '@/utils/biometricLockout';

export const AppLock: React.FC<AppLockProps> = ({ children }) => {
  const appState = useRef(AppState.currentState);
  const [isLocked, setIsLocked] = useState(true); // Default to locked
  const { isSupported, isEnrolled, authenticate, getBiometryLabel } = useBiometrics();
  const theme = useTheme();
  const [checking, setChecking] = useState(true);
  const [lockTiming, setLockTiming] = useState<LockTiming>('immediate');
  const lastBackgroundAtRef = useRef<number | null>(null);
  const isMounted = useRef(false);
  const setSecurityLocked = useStore((s) => s.setSecurityLocked);

  // Per-mount attempt log: timestamps of failed authenticate() calls.
  // We slide the window so successes earlier-this-minute don't keep counting.
  const failedAttemptsRef = useRef<number[]>([]);
  const [lockoutUntilMs, setLockoutUntilMs] = useState<number>(0);
  const [, forceTick] = useState(0);
  // Guards against overlapping biometric prompts. The mount path
  // (checkBiometrics) and the isLocked effect can both reach unlockApp(); without
  // this, the OS dialog could be requested twice in a row.
  const authInFlightRef = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      try {
        const [saved, savedLastBg] = await Promise.all([
          SecureStore.getItemAsync(LOCK_TIMING_KEY),
          AsyncStorage.getItem(LAST_BACKGROUND_KEY)
        ]);

        let currentTiming: LockTiming = 'immediate';
        if (isLockTiming(saved)) {
          setLockTiming(saved);
          currentTiming = saved;
        }

        if (savedLastBg) {
          const lastBg = parseInt(savedLastBg, 10);
          lastBackgroundAtRef.current = lastBg;
          const timeoutMs = lockTimingToMs(currentTiming);
          
          if (timeoutMs > 0 && Date.now() - lastBg < timeoutMs) {
            setIsLocked(false);
            await setSecurityLocked(false);
            setChecking(false);
            return;
          }
        }
      } catch {}
      
      // If we didn't unlock above, trigger biometrics check
      if (isMounted.current) {
        checkBiometrics();
      }
    };
    load();
    return () => { isMounted.current = false; };
  }, [setSecurityLocked]);

  const checkBiometrics = async () => {
    // Wait for hook to initialize
    // Quick delay to let hook settle and ensure we haven't unlocked in the meantime
    setTimeout(async () => {
        if (!isMounted.current) return;
        
        // If already unlocked (e.g. by time check), don't prompt
        if (!isLocked) {
             setChecking(false);
             return;
        }

        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        
        if (!hasHardware || !isEnrolled) {
            setIsLocked(false);
            await setSecurityLocked(false);
            setChecking(false);
            return;
        }

        // Try to authenticate
        unlockApp();
    }, 500);
  };

  const unlockApp = async () => {
    // Only one biometric prompt may be in flight at a time (see authInFlightRef).
    if (authInFlightRef.current) return;

    // Sliding-window lockout check: too many failures in a minute → enforce
    // a 30s cooldown before prompting again. Without this, a bystander
    // could keep cancelling+retrying the biometric prompt to wear down
    // the lock-attempt counter the OS itself enforces.
    const now = Date.now();
    if (isLockedOutNow(lockoutUntilMs, now)) {
      setChecking(false);
      return;
    }

    authInFlightRef.current = true;
    try {
      const result = await authenticate('Lås upp Noter');
      if (result.success) {
        setIsLocked(false);
        await setSecurityLocked(false);
        failedAttemptsRef.current = [];
      } else {
        const { nextAttempts, lockoutUntil } = recordFailure(failedAttemptsRef.current, Date.now());
        failedAttemptsRef.current = nextAttempts;
        if (lockoutUntil !== null) {
          setLockoutUntilMs(lockoutUntil);
          // Tick on lockout expiry so the UI re-renders without lockout text.
          setTimeout(() => {
            if (isMounted.current) {
              setLockoutUntilMs(0);
              failedAttemptsRef.current = [];
              forceTick((n) => n + 1);
            }
          }, LOCKOUT_DURATION_MS + 100);
        }
      }
    } finally {
      authInFlightRef.current = false;
      setChecking(false);
    }
  };

  // AppState listener
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        LocalAuthentication.hasHardwareAsync().then(async (hasHardware) => {
          if (!hasHardware) return;
          const isEnrolledNow = await LocalAuthentication.isEnrolledAsync();
          if (!isEnrolledNow) return;

          let timingToUse: LockTiming = lockTiming;
          try {
            const saved = await SecureStore.getItemAsync(LOCK_TIMING_KEY);
            if (isLockTiming(saved)) {
              timingToUse = saved;
              if (saved !== lockTiming) setLockTiming(saved);
            }
          } catch {}

          const timeoutMs = lockTimingToMs(timingToUse);
          if (timeoutMs === 0) {
            setIsLocked(true);
            setSecurityLocked(true);
            return;
          }

          const lastBg = lastBackgroundAtRef.current;
          if (!lastBg) return;
          if (Date.now() - lastBg >= timeoutMs) {
            setIsLocked(true);
            setSecurityLocked(true);
          }
        });
      }

      if (nextAppState.match(/inactive|background/)) {
        const now = Date.now();
        lastBackgroundAtRef.current = now;
        AsyncStorage.setItem(LAST_BACKGROUND_KEY, now.toString()).catch(() => {});
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [lockTiming, setSecurityLocked]);

  // Effect to trigger auth when locked becomes true
  useEffect(() => {
    if (isLocked && !checking && isMounted.current) {
        // If we just got locked (e.g. from background), try to auth immediately
        unlockApp();
    }
  }, [isLocked]);


  if (!isLocked) {
    return <>{children}</>;
  }

  const now = Date.now();
  const isLockedOut = isLockedOutNow(lockoutUntilMs, now);
  const lockoutSecondsRemaining = remainingSeconds(lockoutUntilMs, now);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.surface} elevation={4}>
        <Text variant="headlineMedium" style={{ marginBottom: 20 }}>
          Noter är låst
        </Text>
        <Text style={{ marginBottom: 20, textAlign: 'center' }}>
          {isLockedOut
            ? `För många misslyckade försök. Försök igen om ${lockoutSecondsRemaining}s.`
            : 'Verifiera din identitet för att fortsätta.'}
        </Text>
        <Button
          mode="contained"
          onPress={unlockApp}
          icon="lock-open"
          disabled={isLockedOut}
          accessibilityState={{ disabled: isLockedOut }}
        >
          {isLockedOut ? `Försök igen om ${lockoutSecondsRemaining}s` : `Lås upp med ${getBiometryLabel()}`}
        </Button>
      </Surface>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  surface: {
    padding: 30,
    alignItems: 'center',
    borderRadius: 10,
    width: '80%',
  },
});
