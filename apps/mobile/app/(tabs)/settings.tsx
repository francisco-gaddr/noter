import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Alert, Platform, useWindowDimensions, ScrollView } from 'react-native';
import { List, Switch, Text, Divider, useTheme, Menu, Dialog, Portal, Button, TextInput, RadioButton } from 'react-native-paper';
import { useThemeContext } from '@/context/ThemeContext';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { useStore } from '@/stores/useStore';
import { API_URL, setApiUrl, getAuthToken } from '@/services/api';
import { disconnectSocket, initSocket } from '@/services/socket';
import { BackendUrlDialog } from '@/components/BackendUrlDialog';
import i18n from '@/lib/i18n';

export default function SettingsScreen() {
  const { theme, setTheme } = useThemeContext();
  const setToken = useStore((s) => s.setToken);
  const paperTheme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const t = i18n.t.bind(i18n);
  const [language, setLanguage] = useState<'sv' | 'en'>('sv');
  const [lockTiming, setLockTiming] = useState<'immediate' | '5min' | '15min' | '30min' | '1h'>('immediate');
  const [lockTimingDialogVisible, setLockTimingDialogVisible] = useState(false);
  
  // Backend URL state
  const [backendUrl, setBackendUrl] = useState(API_URL);
  const [tempBackendUrl, setTempBackendUrl] = useState('');
  const [backendUrlDialogVisible, setBackendUrlDialogVisible] = useState(false);

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
        i18n.locale = saved;
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
      
      // Update local state with current API_URL
      setBackendUrl(API_URL);
    })();
  }, []);

  const saveLanguage = async (lang: 'sv' | 'en') => {
    setLanguage(lang);
    i18n.locale = lang;
    try {
      await SecureStore.setItemAsync('language', lang);
    } catch (e) {
    }
  };

  const lockTimingLabel = (v: typeof lockTiming) => {
    if (v === 'immediate') return t('immediate');
    if (v === '5min') return t('after5min');
    if (v === '15min') return t('after15min');
    if (v === '30min') return t('after30min');
    return t('after1h');
  };

  const saveLockTiming = async (timing: typeof lockTiming) => {
    setLockTiming(timing);
    try {
      await SecureStore.setItemAsync('lockTiming', timing);
    } catch {}
  };

  const handleSaveBackendUrl = async () => {
    if (tempBackendUrl) {
      await setApiUrl(tempBackendUrl);
      setBackendUrl(tempBackendUrl);
      setBackendUrlDialogVisible(false);
      
      // Reconnect socket with new URL
      disconnectSocket();
      initSocket(getAuthToken());
      
      Alert.alert(t('success'), t('backendUrlHint'));
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      t('logout'),
      t('logoutConfirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('logout'),
          style: 'destructive',
          onPress: async () => {
               await SecureStore.deleteItemAsync('token');
               setToken(null);
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
    <ScrollView style={[styles.container, { backgroundColor: paperTheme.colors.background }]}>
      <List.Section title={t('appearance')}>
        <List.Item
          title={t('theme')}
          description={`${t('current')}: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
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
             {t('tapToCycleTheme')}
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('language')}>
        <List.Item
          title={t('language')}
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
             {t('toggleLanguageHint')}
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('security')}>
        <List.Item
          title={t('appLock')}
          description={`${t('lockTiming')}: ${lockTimingLabel(lockTiming)}`}
          left={props => <List.Icon {...props} icon="lock" />}
          onPress={() => setLockTimingDialogVisible(true)}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('lockTimingHint')}
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('developer')}>
        <List.Item
          title={t('backendUrl')}
          description={backendUrl}
          left={props => <List.Icon {...props} icon="server" />}
          onPress={() => {
            setBackendUrlDialogVisible(true);
          }}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('backendUrlHint')}
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('account')}>
        <List.Item
          title={t('logout')}
          left={props => <List.Icon {...props} icon="logout" />}
          onPress={handleLogout}
        />
      </List.Section>
      
      <View style={styles.version}>
         <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceDisabled }}>
            Version {String(appVersion)} ({String(buildNumber)})
         </Text>
      </View>

      <Portal>
        {/* App Lock Dialog */}
        <Dialog visible={lockTimingDialogVisible} onDismiss={() => setLockTimingDialogVisible(false)}>
          <Dialog.Title>{t('chooseLockTiming')}</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group onValueChange={value => {
              saveLockTiming(value as any);
              setLockTimingDialogVisible(false);
            }} value={lockTiming}>
              <RadioButton.Item label={t('immediate')} value="immediate" />
              <RadioButton.Item label={t('after5min')} value="5min" />
              <RadioButton.Item label={t('after15min')} value="15min" />
              <RadioButton.Item label={t('after30min')} value="30min" />
              <RadioButton.Item label={t('after1h')} value="1h" />
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLockTimingDialogVisible(false)}>{t('cancel')}</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Backend URL Dialog */}
        <BackendUrlDialog
          visible={backendUrlDialogVisible}
          onDismiss={() => setBackendUrlDialogVisible(false)}
          currentUrl={backendUrl}
          onSave={handleSaveBackendUrl}
        />
      </Portal>
    </ScrollView>
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
