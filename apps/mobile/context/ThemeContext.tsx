import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { decrypt, encrypt } from '@repo/shared';
import { logError } from '@/services/logger';

type ThemeType = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  actualTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
  actualTheme: 'light',
});

export const useThemeContext = () => useContext(ThemeContext);

export const ThemeContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useSystemColorScheme();
  const [theme, setThemeState] = useState<ThemeType>('system');

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    if (Platform.OS === 'web') return;
    try {
      const savedThemeRaw = await SecureStore.getItemAsync('user_theme');
      const savedTheme = (() => {
        if (!savedThemeRaw) return null;
        try {
          return decrypt(savedThemeRaw);
        } catch {
          return savedThemeRaw;
        }
      })();
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setThemeState(savedTheme);
      }
    } catch (error) {
      logError('Failed to load theme', error);
    }
  };

  const setTheme = async (newTheme: ThemeType) => {
    setThemeState(newTheme);
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.setItemAsync('user_theme', encrypt(newTheme));
    } catch (error) {
      logError('Failed to save theme', error);
    }
  };

  const actualTheme = theme === 'system' ? (systemColorScheme ?? 'light') : theme;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
