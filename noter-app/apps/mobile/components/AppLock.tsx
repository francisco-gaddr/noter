import React, { useState, useEffect, useRef } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, Text, Surface, useTheme } from 'react-native-paper';
import { useBiometrics } from '@/hooks/useBiometrics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '@/stores/useStore';
import { useTranslation } from 'react-i18next';
import { isExpoGo } from '@/utils/runtime';

interface AppLockProps {
  children: React.ReactNode;
}

type LockTiming = 'immediate' | '5min' | '15min' | '30min' | '1h' | '3h' | '5h' | '8h';

const LOCK_TIMING_KEY = 'lockTiming';
const LAST_BACKGROUND_KEY = 'lastBackgroundAt';

const lockTimingToMs = (timing: LockTiming) => {
  if (timing === 'immediate') return 0;
  if (timing === '5min') return 5 * 60 * 1000;
  if (timing === '15min') return 15 * 60 * 1000;
  if (timing === '30min') return 30 * 60 * 1000;
  if (timing === '3h') return 3 * 60 * 60 * 1000;
  if (timing === '5h') return 5 * 60 * 60 * 1000;
  if (timing === '8h') return 8 * 60 * 60 * 1000;
  return 60 * 60 * 1000;
};

export const AppLock: React.FC<AppLockProps> = ({ children }) => {
  const { t } = useTranslation();
  const expoGo = isExpoGo();
  const appState = useRef(AppState.currentState);
  const [isLocked, setIsLocked] = useState(!expoGo);
  const { authenticate, getBiometryLabel } = useBiometrics();
  const theme = useTheme();
  const [checking, setChecking] = useState(!expoGo);
  const [bootstrapped, setBootstrapped] = useState(expoGo);
  const [lockTiming, setLockTiming] = useState<LockTiming>('immediate');
  const lastBackgroundAtRef = useRef<number | null>(null);
  const isMounted = useRef(false);
  const authInFlightRef = useRef(false);
  const setSecurityLocked = useStore((s) => s.setSecurityLocked);

  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      if (expoGo) {
        setIsLocked(false);
        await setSecurityLocked(false);
        setChecking(false);
        setBootstrapped(true);
        return;
      }
      try {
        const [saved, savedLastBg] = await Promise.all([
          SecureStore.getItemAsync(LOCK_TIMING_KEY),
          AsyncStorage.getItem(LAST_BACKGROUND_KEY)
        ]);

        let currentTiming: LockTiming = 'immediate';
        if (saved === 'immediate' || saved === '5min' || saved === '15min' || saved === '30min' || saved === '1h' || saved === '3h' || saved === '5h' || saved === '8h') {
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
            setBootstrapped(true);
            return;
          }
        }
      } catch {}
      await setSecurityLocked(true);
      if (isMounted.current) {
        setChecking(false);
        setBootstrapped(true);
      }
    };
    load();
    return () => { isMounted.current = false; };
  }, [expoGo, setSecurityLocked]);

  const unlockApp = async () => {
    if (authInFlightRef.current) {
      return;
    }
    authInFlightRef.current = true;
    setChecking(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;
      if (!hasHardware || !enrolled) {
        setIsLocked(false);
        await setSecurityLocked(false);
        return;
      }
      const result = await authenticate(t('passwordModal.unlock'));
      if (result.success) {
        setIsLocked(false);
        await setSecurityLocked(false);
      }
    } finally {
      authInFlightRef.current = false;
      setChecking(false);
    }
  };

  // AppState listener
  useEffect(() => {
    if (expoGo) return;
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current === 'background' &&
        nextAppState === 'active'
      ) {
        if (authInFlightRef.current) {
          appState.current = nextAppState;
          return;
        }
        LocalAuthentication.hasHardwareAsync().then(async (hasHardware) => {
          if (!hasHardware) return;
          const isEnrolledNow = await LocalAuthentication.isEnrolledAsync();
          if (!isEnrolledNow) return;

          let timingToUse: LockTiming = lockTiming;
          try {
            const saved = await SecureStore.getItemAsync(LOCK_TIMING_KEY);
            if (saved === 'immediate' || saved === '5min' || saved === '15min' || saved === '30min' || saved === '1h' || saved === '3h' || saved === '5h' || saved === '8h') {
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

      if (nextAppState === 'background') {
        if (authInFlightRef.current) {
          appState.current = nextAppState;
          return;
        }
        const now = Date.now();
        lastBackgroundAtRef.current = now;
        AsyncStorage.setItem(LAST_BACKGROUND_KEY, now.toString()).catch(() => {});
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [expoGo, lockTiming, setSecurityLocked]);

  // Effect to trigger auth when locked becomes true
  useEffect(() => {
    if (!bootstrapped) return;
    if (expoGo) return;
    if (isLocked && isMounted.current) {
      void unlockApp();
    }
  }, [isLocked, bootstrapped, expoGo]);


  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.surface} elevation={4}>
        <Text variant="headlineMedium" style={{ marginBottom: 20 }}>
          {t('settings.lock')}
        </Text>
        <Text style={{ marginBottom: 20, textAlign: 'center' }}>
          {t('note.lockedMessage')}
        </Text>
        {checking ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>
              {`${t('passwordModal.unlock')} ${t('common.with')} ${getBiometryLabel()}`}
            </Text>
          </View>
        ) : (
          <Button 
            mode="contained" 
            onPress={unlockApp}
            icon="lock-open"
          >
            {`${t('passwordModal.unlock')} ${t('common.with')} ${getBiometryLabel()}`}
          </Button>
        )}
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
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 12,
    textAlign: 'center',
  },
});
