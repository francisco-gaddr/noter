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

export default function SettingsScreen() {
  const { theme, setTheme } = useThemeContext();
  const setToken = useStore((s) => s.setToken);
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
        
        Alert.alert('Inställning sparad', 'Backend-adress har uppdaterats och anslutningen startas om.');
      } catch (error) {
        console.error('SettingsScreen: Error saving backend URL:', error);
        Alert.alert('Fel', 'Kunde inte spara inställningar.');
      }
    } else {
        console.log('SettingsScreen: URL is empty, ignoring.');
    }
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
        <List.Item
          title="App-lås"
          description={`Lås: ${lockTimingLabel(lockTiming)}`}
          left={props => <List.Icon {...props} icon="lock" />}
          onPress={() => setLockTimingDialogVisible(true)}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            Välj hur snabbt appen ska låsas vid inaktivitet
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="Developer">
        <List.Item
          title="Backend URL"
          description={backendUrl}
          left={props => <List.Icon {...props} icon="server" />}
          onPress={() => {
            setBackendUrlDialogVisible(true);
          }}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            Ställ in adress till backend API
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

      <Portal>
        {/* App Lock Dialog */}
        <Dialog visible={lockTimingDialogVisible} onDismiss={() => setLockTimingDialogVisible(false)}>
          <Dialog.Title>Välj tid för autolås</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group onValueChange={value => {
              saveLockTiming(value as any);
              setLockTimingDialogVisible(false);
            }} value={lockTiming}>
              <RadioButton.Item label="Direkt" value="immediate" />
              <RadioButton.Item label="Efter 5 min" value="5min" />
              <RadioButton.Item label="Efter 15 min" value="15min" />
              <RadioButton.Item label="Efter 30 min" value="30min" />
              <RadioButton.Item label="Efter 1 h" value="1h" />
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLockTimingDialogVisible(false)}>Avbryt</Button>
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
