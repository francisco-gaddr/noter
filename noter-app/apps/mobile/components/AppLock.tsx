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

type LockTiming = 'immediate' | '5min' | '15min' | '30min' | '1h';

const LOCK_TIMING_KEY = 'lockTiming';
const LAST_BACKGROUND_KEY = 'lastBackgroundAt';

const lockTimingToMs = (timing: LockTiming) => {
  if (timing === 'immediate') return 0;
  if (timing === '5min') return 5 * 60 * 1000;
  if (timing === '15min') return 15 * 60 * 1000;
  if (timing === '30min') return 30 * 60 * 1000;
  return 60 * 60 * 1000;
};

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

  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      try {
        const [saved, savedLastBg] = await Promise.all([
          SecureStore.getItemAsync(LOCK_TIMING_KEY),
          AsyncStorage.getItem(LAST_BACKGROUND_KEY)
        ]);

        let currentTiming: LockTiming = 'immediate';
        if (saved === 'immediate' || saved === '5min' || saved === '15min' || saved === '30min' || saved === '1h') {
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
    const result = await authenticate('Lås upp Noter');
    if (result.success) {
      setIsLocked(false);
      await setSecurityLocked(false);
    }
    setChecking(false);
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
            if (saved === 'immediate' || saved === '5min' || saved === '15min' || saved === '30min' || saved === '1h') {
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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.surface} elevation={4}>
        <Text variant="headlineMedium" style={{ marginBottom: 20 }}>
          Noter är låst
        </Text>
        <Text style={{ marginBottom: 20, textAlign: 'center' }}>
          Verifiera din identitet för att fortsätta.
        </Text>
        <Button 
          mode="contained" 
          onPress={unlockApp}
          icon="lock-open"
        >
          Lås upp med {getBiometryLabel()}
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
