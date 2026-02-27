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
import { useTranslation } from 'react-i18next';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeContext();
  const setToken = useStore((s) => s.setToken);
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const paperTheme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
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
        i18n.changeLanguage(saved);
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
    i18n.changeLanguage(lang);
    try {
      await SecureStore.setItemAsync('language', lang);
    } catch (e) {
      // Non-fatal
    }
  };

  const lockTimingLabel = (v: typeof lockTiming) => {
    if (v === 'immediate') return t('settings.lockImmediate', 'Direkt');
    if (v === '5min') return t('settings.lock5min', 'Efter 5 min');
    if (v === '15min') return t('settings.lock15min', 'Efter 15 min');
    if (v === '30min') return t('settings.lock30min', 'Efter 30 min');
    return t('settings.lock1h', 'Efter 1 h');
  };

  const saveLockTiming = async (timing: typeof lockTiming) => {
    setLockTiming(timing);
    try {
      await SecureStore.setItemAsync('lockTiming', timing);
    } catch {}
  };

  const handleSaveBackendUrl = async (url: string) => {
    console.log('SettingsScreen: handleSaveBackendUrl called with:', url);
    if (url) {
      try {
        await setApiUrl(url);
        setBackendUrl(url);
        setBackendUrlDialogVisible(false);
        
        // Reconnect socket with new URL
        console.log('SettingsScreen: Reconnecting socket...');
        disconnectSocket();
        initSocket(getAuthToken());
        
        Alert.alert(t('common.success'), t('settings.backendUpdated', 'Backend-adress har uppdaterats och anslutningen startas om.'));
      } catch (error) {
        console.error('SettingsScreen: Error saving backend URL:', error);
        Alert.alert(t('common.error'), t('settings.saveError', 'Kunde inte spara inställningar.'));
      }
    } else {
        console.log('SettingsScreen: URL is empty, ignoring.');
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      t('common.logout'),
      t('settings.logoutConfirm', 'Are you sure you want to logout?'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.logout'),
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
      <List.Section title={t('common.appearance')}>
        <List.Item
          title={t('common.theme')}
          description={`${t('settings.currentTheme', 'Current')}: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
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
             {t('settings.themeHint', 'Tap item to cycle: System → Light → Dark')}
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('common.language')}>
        <List.Item
          title={t('common.language')}
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
             {t('settings.languageHint', 'Växla språk: Svenska ↔ English (lagras lokalt)')}
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('common.security')}>
        <List.Item
          title={t('settings.autoLock')}
          description={`${t('settings.lock', 'Lås')}: ${lockTimingLabel(lockTiming)}`}
          left={props => <List.Icon {...props} icon="lock" />}
          onPress={() => setLockTimingDialogVisible(true)}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('settings.lockHint', 'Välj hur snabbt appen ska låsas vid inaktivitet')}
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('common.notifications')}>
        <List.Item
          title={t('settings.pushNotifications')}
          description={notificationsEnabled ? t('common.on', 'På') : t('common.off', 'Av')}
          left={props => <List.Icon {...props} icon="bell" />}
          right={() => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
              <Switch
                value={notificationsEnabled}
                onValueChange={(val) => setNotificationsEnabled(val)}
              />
            </View>
          )}
        />
        <View style={styles.hint}>
           <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
             {t('settings.notificationsHint', 'Slå på för att få påminnelser om tasks')}
           </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('common.developer')}>
        <List.Item
          title={t('settings.backendUrl')}
          description={backendUrl}
          left={props => <List.Icon {...props} icon="server" />}
          onPress={() => {
            setBackendUrlDialogVisible(true);
          }}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('settings.backendHint', 'Ställ in adress till backend API')}
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title={t('common.account')}>
        <List.Item
          title={t('common.logout')}
          left={props => <List.Icon {...props} icon="logout" />}
          onPress={handleLogout}
        />
      </List.Section>
      
      <View style={styles.version}>
         <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceDisabled }}>
            {t('common.version')}: {String(appVersion)}
         </Text>
         <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceDisabled }}>
            {t('common.buildId')}: {String(buildNumber)}
         </Text>
      </View>

      <Portal>
        {/* App Lock Dialog */}
        <Dialog visible={lockTimingDialogVisible} onDismiss={() => setLockTimingDialogVisible(false)}>
          <Dialog.Title>{t('settings.selectLockTime', 'Välj tid för autolås')}</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group onValueChange={value => {
              saveLockTiming(value as any);
              setLockTimingDialogVisible(false);
            }} value={lockTiming}>
              <RadioButton.Item label={t('settings.lockImmediate', 'Direkt')} value="immediate" />
              <RadioButton.Item label={t('settings.lock5min', 'Efter 5 min')} value="5min" />
              <RadioButton.Item label={t('settings.lock15min', 'Efter 15 min')} value="15min" />
              <RadioButton.Item label={t('settings.lock30min', 'Efter 30 min')} value="30min" />
              <RadioButton.Item label={t('settings.lock1h', 'Efter 1 h')} value="1h" />
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLockTimingDialogVisible(false)}>{t('common.cancel')}</Button>
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
