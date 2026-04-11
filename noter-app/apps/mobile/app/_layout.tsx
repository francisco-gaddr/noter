import 'react-native-get-random-values';
import '@/utils/polyfill';
import '../services/i18n';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider, Snackbar, Text, useTheme } from 'react-native-paper';

import { useColorScheme } from '@/components/useColorScheme';

import { ThemeContextProvider, useThemeContext } from '@/context/ThemeContext';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  const [fontTimeoutElapsed, setFontTimeoutElapsed] = useState(false);
  const appReady = loaded || Boolean(error) || fontTimeoutElapsed;

  useEffect(() => {
    if (!error) return;
    console.warn('Font loading failed, continuing without custom fonts', error);
  }, [error]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFontTimeoutElapsed(true);
    }, isExpoGo() ? 1500 : 3000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!appReady) return;
    recordMobileAppReady();
    void SplashScreen.hideAsync().catch(() => {});
  }, [appReady]);

  if (!appReady) {
    return null;
  }

  return (
    <ThemeContextProvider>
      <RootLayoutNav />
    </ThemeContextProvider>
  );
}

import { AppLock } from '@/components/AppLock';
import { CustomErrorBoundary } from '@/components/ErrorBoundary';
import { NetworkStatus } from '@/components/NetworkStatus';
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { useStore } from '@/stores/useStore';

import { Alert, InteractionManager, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { extractTaskIdFromNotificationResponse, NotificationTaskIntentQueue } from '@/utils/notificationTaskIntent';
import { useTranslation } from 'react-i18next';
import { isExpoGo } from '@/utils/runtime';
import { runStartupBootstrap } from '@/services/startup';
import { recordMobileAppReady } from '@/services/perfMetrics';
import { initializeAiBackgroundInstallRecovery } from '@/services/ai/backgroundInstall';

export function RootLayoutNav() {
  const { actualTheme } = useThemeContext();
  const colorScheme = actualTheme;
  const { init } = require('@/stores/useStore').useStore.getState();
  require('react').useEffect(() => {
    let active = true;
    void runStartupBootstrap(init, (message, startupError) => {
      if (!active) return;
      console.error('RootLayoutNav bootstrap failed', startupError);
      useStore.setState({
        error: `Startfel: ${message}`,
        isInitialized: true,
        isLoading: false,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    initializeAiBackgroundInstallRecovery().catch(() => {});
  }, []);

  const router = useRouter();
  const segments = useSegments();
  const token = useStore((s) => s.token);
  const isInitialized = useStore((s) => s.isInitialized);
  const securityLocked = useStore((s) => s.securityLocked);
  const inAuth = segments[0] === 'auth';
  const taskIntentQueueRef = useRef(new NotificationTaskIntentQueue());
  const lastHandledNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!token && !inAuth) {
      router.replace('/auth/login');
      return;
    }
    if (token && inAuth) {
      const pendingTaskId = taskIntentQueueRef.current.consumeIfReady({
        isInitialized,
        hasToken: Boolean(token),
        securityLocked,
      });
      if (pendingTaskId) {
        router.replace(`/task/${pendingTaskId}`);
        return;
      }
      router.replace('/(tabs)');
    }
  }, [token, inAuth, isInitialized, router, segments, securityLocked]);

  useEffect(() => {
    const pendingTaskId = taskIntentQueueRef.current.consumeIfReady({
      isInitialized,
      hasToken: Boolean(token),
      securityLocked,
    });
    if (pendingTaskId) {
      router.push(`/task/${pendingTaskId}`);
    }
  }, [isInitialized, token, securityLocked, router]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const Notifications = await import('expo-notifications');
          await Notifications.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: false,
              shouldShowBanner: true,
              shouldShowList: true,
            }),
          });
          const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
            const responseId = response?.notification?.request?.identifier;
            if (typeof responseId === 'string' && responseId === lastHandledNotificationRef.current) {
              return;
            }
            if (typeof responseId === 'string') {
              lastHandledNotificationRef.current = responseId;
            }
            const taskId = extractTaskIdFromNotificationResponse(response);
            if (taskId) {
              taskIntentQueueRef.current.setPending(taskId);
              const pendingTaskId = taskIntentQueueRef.current.consumeIfReady({
                isInitialized,
                hasToken: Boolean(token),
                securityLocked,
              });
              if (pendingTaskId) {
                router.push(`/task/${pendingTaskId}`);
              }
            }
          });
          const lastResponse = await Notifications.getLastNotificationResponseAsync?.();
          if (lastResponse) {
            const responseId = lastResponse?.notification?.request?.identifier;
            if (typeof responseId === 'string' && responseId !== lastHandledNotificationRef.current) {
              lastHandledNotificationRef.current = responseId;
              const taskId = extractTaskIdFromNotificationResponse(lastResponse);
              if (taskId) {
                taskIntentQueueRef.current.setPending(taskId);
                const pendingTaskId = taskIntentQueueRef.current.consumeIfReady({
                  isInitialized,
                  hasToken: Boolean(token),
                  securityLocked,
                });
                if (pendingTaskId) {
                  router.push(`/task/${pendingTaskId}`);
                }
              }
            }
          }
          unsub = () => subscription.remove();
        } catch {
        }
      })();
    });
    return () => {
      interactionHandle.cancel();
      if (unsub) unsub();
    };
  }, [router, isInitialized, token, securityLocked]);

  const paperTheme = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={paperTheme}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <CustomErrorBoundary>
            <AppLock>
              <NetworkStatus />
              <ErrorToaster />
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="auth/login" options={{ headerShown: false }} />
                <Stack.Screen name="auth/register" options={{ headerShown: false }} />
                <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
                <Stack.Screen name="note/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
              </Stack>
            </AppLock>
          </CustomErrorBoundary>
        </ThemeProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

function ErrorToaster() {
  const { t } = useTranslation();
  const theme = useTheme();
  const error = useStore((s) => s.error);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (!error) return;
    setMessage(String(error));
    setVisible(true);
  }, [error]);

  if (!message) return null;

  const short = message.length > 90 ? `${message.slice(0, 90)}…` : message;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 18,
        zIndex: 99999,
      }}
    >
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={5000}
        style={{
          backgroundColor: theme.colors.elevation.level3,
          borderRadius: 12,
        }}
        action={{
          label: t('common.error'),
          onPress: () => Alert.alert(t('common.error'), message),
        }}
      >
        <Text numberOfLines={2}>{short}</Text>
      </Snackbar>
    </View>
  );
}
