import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type ThemeType = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  actualTheme: 'light' | 'dark';
  /**
   * Becomes true once SecureStore has been read on app boot. Bootstrap code
   * should keep the splash screen up until `ready` is true so the user never
   * sees a light→dark flash on cold start.
   */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
  actualTheme: 'light',
  ready: false,
});

export const useThemeContext = () => useContext(ThemeContext);

// Module-level promise so the boot path (RootLayout) can await theme
// hydration BEFORE rendering. Without this the provider effect runs after
// first paint and we get a flash. We deliberately don't gate on web because
// the web platform handles theme via system color scheme synchronously and
// SecureStore is a noop there.
let themeReadPromise: Promise<ThemeType | null> | null = null;
export const preloadTheme = (): Promise<ThemeType | null> => {
  if (themeReadPromise) return themeReadPromise;
  if (Platform.OS === 'web') {
    themeReadPromise = Promise.resolve(null);
    return themeReadPromise;
  }
  themeReadPromise = (async () => {
    try {
      const saved = await SecureStore.getItemAsync('user_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
      return null;
    } catch {
      return null;
    }
  })();
  return themeReadPromise;
};

export const ThemeContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useSystemColorScheme();
  const [theme, setThemeState] = useState<ThemeType>('system');
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    // Reuse the boot-time preload if RootLayout already kicked it off;
    // otherwise this is the first read.
    preloadTheme().then((stored) => {
      if (!mounted) return;
      if (stored) setThemeState(stored);
      setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  const setTheme = async (newTheme: ThemeType) => {
    setThemeState(newTheme);
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.setItemAsync('user_theme', newTheme);
    } catch (error) {
      console.log('Failed to save theme', error);
    }
  };

  const actualTheme = theme === 'system' ? (systemColorScheme ?? 'light') : theme;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme, ready }}>
      {children}
    </ThemeContext.Provider>
  );
};
