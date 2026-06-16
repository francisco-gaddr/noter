import 'react-native-get-random-values';
import '@/utils/polyfill';
import '../services/i18n';
// react-native-screens v4.x enables natively-rendered Screen primitives by
// default, but we make it explicit at the very top of the entrypoint so a
// future React Navigation upgrade can't silently disable it. Idempotent on
// hot-reload because enableScreens caches its state internally.
import { enableScreens } from 'react-native-screens';
enableScreens(true);
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider, Snackbar, Text, useTheme } from 'react-native-paper';

import { useColorScheme } from '@/components/useColorScheme';

import { ThemeContextProvider, useThemeContext, preloadTheme } from '@/context/ThemeContext';
import { runKvMigrationIfNeeded } from '@/services/storage';
import { restoreCryptoFromDevice } from '@/services/crypto';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  const [bootReady, setBootReady] = useState(false);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Critical-path bootstraps that MUST be done before we reveal UI. Keep this
  // tight — anything that touches the network must time out, otherwise we
  // risk holding the splash forever on poor connections.
  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<void>((r) => setTimeout(r, 4000));
    const bootstrap = async () => {
      try {
        await Promise.race([
          // KV migration is a no-op today; placeholder for future MMKV switch.
          // preloadTheme runs in parallel so the ThemeContext picks up the
          // stored value on its first render — eliminates the light→dark
          // flash on cold start.
          // restoreCryptoFromDevice re-activates v3 E2E from the Keychain backup
          // BEFORE any notes load, so v3 content decrypts on first render. No-op
          // (and never throws) for users who haven't enrolled.
          Promise.all([
            runKvMigrationIfNeeded(),
            preloadTheme(),
            restoreCryptoFromDevice().catch(() => false),
          ]).then(() => undefined),
          timeout,
        ]);
      } catch (e) {
        // Boot must never block on a bootstrap failure — fall through to UI.
        console.warn('[bootstrap] non-fatal error', e);
      }
      if (!cancelled) setBootReady(true);
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  // Splash hides only once BOTH fonts AND critical bootstraps are ready.
  // The 4s timeout above guarantees we never stay on splash forever.
  useEffect(() => {
    if (loaded && bootReady) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [loaded, bootReady]);

  if (!loaded || !bootReady) {
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

import { initApiUrl } from '@/services/api';
import { useAppForegroundSync } from '@/hooks/useAppForegroundSync';
import { useDeepLinkConsumer } from '@/hooks/useDeepLinkConsumer';
import { useRouteRestore } from '@/hooks/useRouteRestore';
import {
  setBackgroundFetchTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
} from '@/services/backgroundFetch';
import { startAgentScheduler, runDueAgentTasks } from '@/services/ai/agentScheduler';
import { registerPushToken } from '@/services/ai/agentBackendSync';
import { Alert, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { PdfExtractorHost } from '@/components/PdfExtractorHost';

function RootLayoutNav() {
  const { actualTheme } = useThemeContext();
  const colorScheme = actualTheme;
  const { init } = require('@/stores/useStore').useStore.getState();
  require('react').useEffect(() => {
    const bootstrap = async () => {
        // KV migration is a no-op today (AsyncStorage is still the store). When
        // we flip `USE_MMKV_WHEN_AVAILABLE` in services/storage/kv.ts the same
        // call performs a one-shot migration with batched, yielding reads so
        // the JS thread stays responsive during cold-start.
        try { await runKvMigrationIfNeeded(); } catch (err) { console.warn('[kv-migration]', err); }
        await initApiUrl();
        await init();
    };
    bootstrap();
  }, []);

  const router = useRouter();
  const segments = useSegments();
  const token = useStore((s) => s.token);
  const isInitialized = useStore((s) => s.isInitialized);
  const inAuth = segments[0] === 'auth';

  // Re-sync when the app comes back to the foreground. The hook handles
  // debounce + cooldown + offline-skip so this is safe to call unconditionally.
  // We only sync when the user is authenticated; an anonymous app coming back
  // to the foreground has nothing to fetch.
  useAppForegroundSync(async () => {
    if (!token) return;
    const store = useStore.getState();
    await Promise.all([store.fetchNotes(), store.fetchTasks()]);
  });

  // Route incoming noter:// + universal links (e.g. https://daylited.com/note/<id>)
  // to the matching internal screen. Same parser as the Electron side so
  // links work identically across platforms.
  useDeepLinkConsumer();

  // Cold-boot route restoration: if the user kills the app while reading a
  // note, the next launch returns them to that note (1h window so we don't
  // resurrect ancient state). Gated on auth — anonymous bootflow always
  // lands on the default tab. Hook also persists every navigation, so
  // there's no separate save-step the caller needs to do.
  useRouteRestore(Boolean(token));

  // Register the OS background-fetch task once we have a token. iOS calls
  // us back roughly every 15 minutes (subject to user permission); the
  // injected handler fetches notes + tasks. We tear down the registration
  // when the user logs out so anonymous re-installations don't keep firing
  // it. Idempotent — safe across re-renders.
  useEffect(() => {
    if (!token) {
      void unregisterBackgroundFetch();
      return;
    }
    setBackgroundFetchTask(async () => {
      try {
        const store = useStore.getState();
        const before = (store.notes?.length || 0) + (store.tasks?.length || 0);
        await Promise.all([store.fetchNotes(), store.fetchTasks()]);
        // Best-effort catch-up: run any AI tasks that came due while backgrounded.
        const ran = await runDueAgentTasks().catch(() => 0);
        const after = (store.notes?.length || 0) + (store.tasks?.length || 0);
        return (after !== before || ran > 0) ? 'new-data' : 'no-data';
      } catch {
        return 'failed';
      }
    });
    void registerBackgroundFetch();
  }, [token]);

  // Foreground AI-task scheduler: precise runs while the app is open (background
  // is best-effort above). Started/stopped with auth. Also register this device's
  // push token so the always-on backend can notify us about AI tasks.
  useEffect(() => {
    if (!token) return;
    const stop = startAgentScheduler();
    void registerPushToken();
    return stop;
  }, [token]);

  useEffect(() => {
    console.log('RootLayoutNav: Auth State Change', { 
        isInitialized, 
        token: !!token, 
        segments, 
        inAuth 
    });

    if (!isInitialized) return;
    if (!token && !inAuth) {
      console.log('RootLayoutNav: Redirecting to login');
      router.replace('/auth/login');
      return;
    }
    if (token && inAuth) {
      console.log('RootLayoutNav: Redirecting to tabs');
      router.replace('/(tabs)');
    }
  }, [token, inAuth, isInitialized, router, segments]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
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
          const taskId = response?.notification?.request?.content?.data?.taskId;
          if (taskId) {
            router.push(`/task/${taskId}`);
          }
        });
        unsub = () => subscription.remove();
      } catch {
      }
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [router]);

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
              </Stack>
              <PdfExtractorHost />
            </AppLock>
          </CustomErrorBoundary>
        </ThemeProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

function ErrorToaster() {
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
          label: 'Visa',
          onPress: () => Alert.alert('Fel', message),
        }}
      >
        <Text numberOfLines={2}>{short}</Text>
      </Snackbar>
    </View>
  );
}
