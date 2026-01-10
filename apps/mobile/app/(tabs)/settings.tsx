import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Alert, Platform } from 'react-native';
import { List, Switch, Text, Divider, useTheme, Menu, TouchableRipple } from 'react-native-paper';
import { useThemeContext } from '@/context/ThemeContext';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

export default function SettingsScreen() {
  const { theme, setTheme } = useThemeContext();
  const paperTheme = useTheme();
  const router = useRouter();
  const [language, setLanguage] = useState<'sv' | 'en'>('sv');
  const [lockTiming, setLockTiming] = useState<'immediate' | '5min' | '15min' | '30min' | '1h'>('immediate');
  const [lockTimingMenuVisible, setLockTimingMenuVisible] = useState(false);
  
  const appVersion =
    (Constants as any).nativeAppVersion ||
    Constants.expoConfig?.version ||
    'unknown';

  const buildNumber =
    (Constants as any).nativeBuildVersion ||
    (Platform.OS === 'ios'
      ? (Constants.expoConfig?.ios as any)?.buildNumber
      : (Constants.expoConfig?.android as any)?.versionCode) ||
    'unknown';

  useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync('language');
      if (saved === 'sv' || saved === 'en') {
        setLanguage(saved);
      }
      const savedLockTiming = await SecureStore.getItemAsync('lockTiming');
      if (
        savedLockTiming === 'immediate' ||
        savedLockTiming === '5min' ||
        savedLockTiming === '15min' ||
        savedLockTiming === '30min' ||
        savedLockTiming === '1h'
      ) {
        setLockTiming(savedLockTiming);
      }
    })();
  }, []);

  const saveLanguage = async (lang: 'sv' | 'en') => {
    setLanguage(lang);
    try {
      await SecureStore.setItemAsync('language', lang);
    } catch (e) {
      // Non-fatal
    }
  };

  const lockTimingLabel = (v: typeof lockTiming) => {
    if (v === 'immediate') return 'Direkt';
    if (v === '5min') return 'Efter 5 min';
    if (v === '15min') return 'Efter 15 min';
    if (v === '30min') return 'Efter 30 min';
    return 'Efter 1 h';
  };

  const saveLockTiming = async (timing: typeof lockTiming) => {
    setLockTiming(timing);
    try {
      await SecureStore.setItemAsync('lockTiming', timing);
    } catch {}
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
             await SecureStore.deleteItemAsync('token');
             router.replace('/auth/login'); 
          }
        }
      ]
    );
  };

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  return (
    <View style={[styles.container, { backgroundColor: paperTheme.colors.background }]}>
      <List.Section title="Appearance">
        <List.Item
          title="Theme"
          description={`Current: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
          left={props => <List.Icon {...props} icon="theme-light-dark" />}
          right={() => (
             <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
                <Switch
                  value={theme === 'dark'}
                  onValueChange={(val) => setTheme(val ? 'dark' : 'light')}
                />
             </View>
          )}
          onPress={cycleTheme}
        />
        <View style={styles.hint}>
           <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
             Tap item to cycle: System → Light → Dark
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="Language">
        <List.Item
          title="Språk"
          description={language === 'sv' ? 'Svenska' : 'English'}
          left={props => <List.Icon {...props} icon="translate" />}
          right={() => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
              <Switch
                value={language === 'en'}
                onValueChange={(val) => saveLanguage(val ? 'en' : 'sv')}
              />
            </View>
          )}
          onPress={() => saveLanguage(language === 'sv' ? 'en' : 'sv')}
        />
        <View style={styles.hint}>
           <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
             Växla språk: Svenska ↔ English (lagras lokalt)
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="Security">
        <Menu
          visible={lockTimingMenuVisible}
          onDismiss={() => setLockTimingMenuVisible(false)}
          contentStyle={{ width: width - 32 }}
          anchor={
              <List.Item
                title="App-lås"
                description={`Lås: ${lockTimingLabel(lockTiming)}`}
                left={props => <List.Icon {...props} icon="lock" />}
                onPress={() => setLockTimingMenuVisible(true)}
              />
          }
        >
          <Menu.Item onPress={() => { setLockTiming('immediate'); saveLockTiming('immediate'); setLockTimingMenuVisible(false); }} title="Direkt" />
          <Menu.Item onPress={() => { setLockTiming('5min'); saveLockTiming('5min'); setLockTimingMenuVisible(false); }} title="Efter 5 min" />
          <Menu.Item onPress={() => { setLockTiming('15min'); saveLockTiming('15min'); setLockTimingMenuVisible(false); }} title="Efter 15 min" />
          <Menu.Item onPress={() => { setLockTiming('30min'); saveLockTiming('30min'); setLockTimingMenuVisible(false); }} title="Efter 30 min" />
          <Menu.Item onPress={() => { setLockTiming('1h'); saveLockTiming('1h'); setLockTimingMenuVisible(false); }} title="Efter 1 h" />
        </Menu>
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            Välj hur snabbt appen ska låsas vid inaktivitet
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="Account">
        <List.Item
          title="Logout"
          left={props => <List.Icon {...props} icon="logout" />}
          onPress={handleLogout}
        />
      </List.Section>
      
      <View style={styles.version}>
         <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceDisabled }}>
            Version {String(appVersion)} ({String(buildNumber)})
         </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hint: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  version: {
     padding: 20,
     alignItems: 'center'
  }
});
