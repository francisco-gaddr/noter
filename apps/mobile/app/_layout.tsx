import '@/utils/polyfill';
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
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
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
import { Alert, View } from 'react-native';

function RootLayoutNav() {
  const { actualTheme } = useThemeContext();
  const colorScheme = actualTheme;
  const { init } = require('@/stores/useStore').useStore.getState();
  require('react').useEffect(() => {
    const bootstrap = async () => {
        await initApiUrl();
        await init();
    };
    bootstrap();
  }, []);

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
                <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
              </Stack>
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
