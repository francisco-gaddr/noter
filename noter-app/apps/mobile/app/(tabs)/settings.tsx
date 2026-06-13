import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Alert, Platform, useWindowDimensions, ScrollView } from 'react-native';
import { List, Switch, Text, Divider, useTheme, Menu, Dialog, Portal, Button, TextInput, RadioButton, Checkbox, ActivityIndicator } from 'react-native-paper';
import { useThemeContext } from '@/context/ThemeContext';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { useStore } from '@/stores/useStore';
import { API_URL, setApiUrl, getAuthToken } from '@/services/api';
import { disconnectSocket, initSocket } from '@/services/socket';
import { BackendUrlDialog } from '@/components/BackendUrlDialog';
import { useTranslation } from 'react-i18next';
import { clearLocalData, clearNotesLocal, clearTasksLocal, clearModelsLocal, clearSyncQueue, getModelsLocal, getSyncQueue } from '@/services/database';
import { deleteModel as deleteModelFile } from '@/services/ai/modelService';
import { enrollOrUnlockCrypto, changeCryptoPassword } from '@/services/crypto';
import { hasActiveDataKey } from '@repo/shared';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeContext();
  const setToken = useStore((s) => s.setToken);
  const fetchNotes = useStore((s) => s.fetchNotes);
  const fetchTasks = useStore((s) => s.fetchTasks);
  const backgroundRefresh = useStore((s) => s.backgroundRefresh);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const syncOfflineChanges = useStore((s) => s.syncOfflineChanges);
  const isOffline = useStore((s) => s.isOffline);
  const isSyncingOffline = useStore((s) => s.isSyncingOffline);
  const paperTheme = useTheme();
  const touchRippleColor = 'rgba(33, 150, 243, 0.22)';
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [language, setLanguage] = useState<'sv' | 'en'>('sv');
  const [lockTiming, setLockTiming] = useState<'immediate' | '5min' | '15min' | '30min' | '1h' | '3h' | '6h' | '12h'>('immediate');
  const [lockTimingDialogVisible, setLockTimingDialogVisible] = useState(false);

  // Manual sync controls.
  const [pendingSync, setPendingSync] = useState<number | null>(null);
  const refreshPendingSync = useCallback(async () => {
    try { setPendingSync((await getSyncQueue()).length); } catch { setPendingSync(null); }
  }, []);
  useEffect(() => { void refreshPendingSync(); }, [refreshPendingSync, isSyncingOffline]);

  const handleSyncNow = async () => {
    await syncOfflineChanges();
    await refreshPendingSync();
  };

  // Enhanced (v3) end-to-end encryption enrolment.
  const [e2eActive, setE2eActive] = useState(hasActiveDataKey());
  const [e2eDialogVisible, setE2eDialogVisible] = useState(false);
  const [e2ePassword, setE2ePassword] = useState('');
  const [e2eBusy, setE2eBusy] = useState(false);

  // Change E2E password (re-wraps the dataKey; no content is re-encrypted).
  const [changePwDialogVisible, setChangePwDialogVisible] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [changePwBusy, setChangePwBusy] = useState(false);

  const handleChangePassword = async () => {
    if (!oldPw || !newPw) return;
    if (newPw !== newPw2) {
      Alert.alert(t('common.error'), t('settings.e2ePwMismatch', 'De nya lösenorden matchar inte.'));
      return;
    }
    setChangePwBusy(true);
    try {
      await changeCryptoPassword(oldPw, newPw);
      setChangePwDialogVisible(false);
      setOldPw(''); setNewPw(''); setNewPw2('');
      Alert.alert(t('common.success'), t('settings.e2ePwChanged', 'Lösenordet är bytt. Inga anteckningar behövde krypteras om.'));
    } catch {
      Alert.alert(t('common.error'), t('settings.e2ePwFailed', 'Kunde inte byta lösenord. Kontrollera det gamla lösenordet och anslutningen.'));
    } finally {
      setChangePwBusy(false);
    }
  };

  const handleEnableE2E = async () => {
    if (!e2ePassword) return;
    setE2eBusy(true);
    try {
      const outcome = await enrollOrUnlockCrypto(e2ePassword);
      setE2eActive(true);
      setE2eDialogVisible(false);
      setE2ePassword('');
      if (outcome.result === 'enrolled' && outcome.recoveryCode) {
        // Show the recovery code ONCE — it is never stored in plaintext.
        Alert.alert(
          t('settings.e2eRecoveryTitle', 'Spara din återställningskod'),
          t('settings.e2eRecoveryBody', 'Förstärkt kryptering är aktiverad. Skriv ner denna kod och förvara den säkert — den är enda sättet att återställa datan om du glömmer lösenordet:') +
            `\n\n${outcome.recoveryCode}`,
        );
      } else {
        Alert.alert(
          t('common.success'),
          t('settings.e2eUnlocked', 'Förstärkt kryptering upplåst på denna enhet.'),
        );
      }
    } catch (e: any) {
      Alert.alert(
        t('common.error'),
        t('settings.e2eFailed', 'Kunde inte aktivera förstärkt kryptering. Kontrollera lösenordet och anslutningen.'),
      );
    } finally {
      setE2eBusy(false);
    }
  };
  
  // Backend URL state
  const [backendUrl, setBackendUrl] = useState(API_URL);
  const [tempBackendUrl, setTempBackendUrl] = useState('');
  const [backendUrlDialogVisible, setBackendUrlDialogVisible] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [confirmClearVisible, setConfirmClearVisible] = useState(false);
  const [clearingLocalData, setClearingLocalData] = useState(false);
  const [clearSelection, setClearSelection] = useState({
    all: false,
    notes: false,
    projects: false,
    taskLists: false,
    tasks: false,
    aiModels: false,
  });
  const hasClearSelection = Object.values(clearSelection).some(Boolean);

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
        savedLockTiming === '1h' ||
        savedLockTiming === '3h' ||
        savedLockTiming === '6h' ||
        savedLockTiming === '12h'
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
    if (v === '3h') return t('settings.lock3h', 'Efter 3 h');
    if (v === '6h') return t('settings.lock6h', 'Efter 6 h');
    if (v === '12h') return t('settings.lock12h', 'Efter 12 h');
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

  const handleClearLocalData = async () => {
    setClearingLocalData(true);
    try {
      if (clearSelection.all) {
        const models = await getModelsLocal();
        for (const model of models) {
          try {
            await deleteModelFile(model.id, model.path);
          } catch {}
        }
        await clearLocalData();
        useStore.setState({ notes: [], tasks: [], error: null });
        setActiveProject(null);
        await fetchNotes();
        await fetchTasks();
        return;
      }

      const shouldClearNotes = clearSelection.notes || clearSelection.projects || clearSelection.taskLists;
      const shouldClearTasks = clearSelection.tasks;
      const shouldClearQueue = shouldClearNotes || shouldClearTasks;

      if (shouldClearNotes) {
        await clearNotesLocal();
        useStore.setState({ notes: [], error: null });
        setActiveProject(null);
        await fetchNotes();
      }

      if (shouldClearTasks) {
        await clearTasksLocal();
        useStore.setState({ tasks: [], error: null });
        await fetchTasks();
      }

      if (shouldClearQueue) {
        await clearSyncQueue();
      }

      if (clearSelection.aiModels) {
        const models = await getModelsLocal();
        for (const model of models) {
          try {
            await deleteModelFile(model.id, model.path);
          } catch {}
        }
        await clearModelsLocal();
      }
    } finally {
      setClearingLocalData(false);
      setClearDialogVisible(false);
      setConfirmClearVisible(false);
      setClearSelection({
        all: false,
        notes: false,
        projects: false,
        taskLists: false,
        tasks: false,
        aiModels: false,
      });
    }
  };

  const handleResync = async () => {
    clearSyncQueue().catch(() => {});
    setTimeout(() => {
      backgroundRefresh().catch(() => {});
    }, 0);
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
          rippleColor={touchRippleColor}
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
          rippleColor={touchRippleColor}
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
          rippleColor={touchRippleColor}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('settings.lockHint', 'Välj hur snabbt appen ska låsas vid inaktivitet')}
          </Text>
        </View>

        <List.Item
          title={t('settings.e2e', 'Förstärkt kryptering (E2E)')}
          description={
            e2eActive
              ? t('settings.e2eOn', 'Aktiv — anteckningar krypteras end-to-end (AES-256-GCM)')
              : t('settings.e2eOff', 'Lås upp med ditt lösenord för att aktivera')
          }
          left={props => <List.Icon {...props} icon={e2eActive ? 'shield-check' : 'shield-key'} />}
          right={() => (
            <Switch
              value={e2eActive}
              disabled={e2eActive}
              onValueChange={() => { if (!e2eActive) setE2eDialogVisible(true); }}
            />
          )}
          onPress={() => { if (!e2eActive) setE2eDialogVisible(true); }}
          rippleColor={touchRippleColor}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('settings.e2eHint', 'Din nyckel härleds från ditt lösenord och lämnar aldrig enheten okrypterad. Befintliga anteckningar migreras automatiskt när de sparas.')}
          </Text>
        </View>

        {e2eActive ? (
          <List.Item
            title={t('settings.e2eChangePw', 'Byt krypteringslösenord')}
            description={t('settings.e2eChangePwDesc', 'Byter lösenordet utan att kryptera om någon data')}
            left={props => <List.Icon {...props} icon="key-change" />}
            onPress={() => setChangePwDialogVisible(true)}
            rippleColor={touchRippleColor}
          />
        ) : null}
      </List.Section>

      <Divider />

      <List.Section title={t('settings.syncSection', 'Synkning')}>
        <List.Item
          title={t('settings.syncNow', 'Synka nu')}
          description={
            isOffline
              ? t('settings.syncOffline', 'Offline — ändringar synkas automatiskt när nätet återkommer')
              : pendingSync && pendingSync > 0
              ? t('settings.syncPending', { defaultValue: '{{count}} ändringar väntar på synk', count: pendingSync })
              : t('settings.syncUpToDate', 'Allt är synkat')
          }
          left={props => <List.Icon {...props} icon={isOffline ? 'cloud-off-outline' : 'cloud-sync-outline'} />}
          onPress={isOffline || isSyncingOffline ? undefined : handleSyncNow}
          right={() => (isSyncingOffline ? <ActivityIndicator style={{ marginRight: 12 }} /> : undefined)}
          disabled={isOffline || isSyncingOffline}
          rippleColor={touchRippleColor}
        />
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
          rippleColor={touchRippleColor}
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
          rippleColor={touchRippleColor}
        />
        <List.Item
          title={t('settings.resync', 'Synka om')}
          description={t('settings.resyncHint', 'Tvinga ny hämtning av anteckningar, projekt och tasks från backend')}
          left={props => <List.Icon {...props} icon="sync" />}
          onPress={handleResync}
          rippleColor={touchRippleColor}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            {t('settings.backendHint', 'Ställ in adress till backend API')}
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="Lagring">
        <List.Item
          title="Rensa lokal lagring"
          description="Tar bort anteckningar, projekt, tasks och AI-data lokalt"
          left={props => <List.Icon {...props} icon="database-remove" />}
          onPress={() => setClearDialogVisible(true)}
          rippleColor={touchRippleColor}
        />
        <View style={styles.hint}>
          <Text variant="bodySmall" style={{ color: paperTheme.colors.onSurfaceVariant }}>
            Rensar allt lokalt och hämtar nytt från servern när internet finns.
          </Text>
        </View>
      </List.Section>

      <Divider />

      <List.Section title="What's New">
        <List.Item
          title="What's New"
          description="Visa senaste uppdateringar"
          left={(props) => <List.Icon {...props} icon="new-box" />}
          onPress={() => router.push('/whats-new')}
          rippleColor={touchRippleColor}
        />
      </List.Section>

      <Divider />

      <List.Section title={t('common.account')}>
        <List.Item
          title={t('common.logout')}
          left={props => <List.Icon {...props} icon="logout" />}
          onPress={handleLogout}
          rippleColor={touchRippleColor}
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
              <RadioButton.Item label={t('settings.lock3h', 'Efter 3 h')} value="3h" />
              <RadioButton.Item label={t('settings.lock6h', 'Efter 6 h')} value="6h" />
              <RadioButton.Item label={t('settings.lock12h', 'Efter 12 h')} value="12h" />
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLockTimingDialogVisible(false)}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Enhanced encryption (E2E) enrolment Dialog */}
        <Dialog visible={e2eDialogVisible} onDismiss={() => { if (!e2eBusy) { setE2eDialogVisible(false); setE2ePassword(''); } }}>
          <Dialog.Title>{t('settings.e2e', 'Förstärkt kryptering (E2E)')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              {t('settings.e2eDialogBody', 'Ange ditt kontolösenord för att härleda din krypteringsnyckel. Glömmer du lösenordet och tappar dina enheter kan datan inte återställas.')}
            </Text>
            <TextInput
              mode="outlined"
              label={t('common.password', 'Lösenord')}
              value={e2ePassword}
              onChangeText={setE2ePassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              disabled={e2eBusy}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => { setE2eDialogVisible(false); setE2ePassword(''); }} disabled={e2eBusy}>
              {t('common.cancel')}
            </Button>
            <Button onPress={handleEnableE2E} loading={e2eBusy} disabled={e2eBusy || !e2ePassword}>
              {t('settings.e2eActivate', 'Aktivera')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Change E2E password Dialog */}
        <Dialog visible={changePwDialogVisible} onDismiss={() => { if (!changePwBusy) { setChangePwDialogVisible(false); setOldPw(''); setNewPw(''); setNewPw2(''); } }}>
          <Dialog.Title>{t('settings.e2eChangePw', 'Byt krypteringslösenord')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              {t('settings.e2eChangePwBody', 'Ditt nuvarande lösenord verifieras och nyckeln packas om under det nya. Ingen anteckning krypteras om — din återställningskod fortsätter fungera.')}
            </Text>
            <TextInput
              mode="outlined"
              label={t('settings.e2eOldPw', 'Nuvarande lösenord')}
              value={oldPw}
              onChangeText={setOldPw}
              secureTextEntry autoCapitalize="none" autoCorrect={false} disabled={changePwBusy}
              style={{ marginBottom: 8 }}
            />
            <TextInput
              mode="outlined"
              label={t('settings.e2eNewPw', 'Nytt lösenord')}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry autoCapitalize="none" autoCorrect={false} disabled={changePwBusy}
              style={{ marginBottom: 8 }}
            />
            <TextInput
              mode="outlined"
              label={t('settings.e2eNewPw2', 'Upprepa nytt lösenord')}
              value={newPw2}
              onChangeText={setNewPw2}
              secureTextEntry autoCapitalize="none" autoCorrect={false} disabled={changePwBusy}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => { setChangePwDialogVisible(false); setOldPw(''); setNewPw(''); setNewPw2(''); }} disabled={changePwBusy}>
              {t('common.cancel')}
            </Button>
            <Button onPress={handleChangePassword} loading={changePwBusy} disabled={changePwBusy || !oldPw || !newPw || !newPw2}>
              {t('settings.e2eChangePwConfirm', 'Byt lösenord')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Backend URL Dialog */}
        <BackendUrlDialog
          visible={backendUrlDialogVisible}
          onDismiss={() => setBackendUrlDialogVisible(false)}
          currentUrl={backendUrl}
          onSave={handleSaveBackendUrl}
        />

        <Dialog visible={clearDialogVisible} onDismiss={() => setClearDialogVisible(false)}>
          <Dialog.Title>Välj vad som ska rensas</Dialog.Title>
          <Dialog.Content>
            <Checkbox.Item
              label="Allt"
              status={clearSelection.all ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({
                all: !prev.all,
                notes: !prev.all,
                projects: !prev.all,
                taskLists: !prev.all,
                tasks: !prev.all,
                aiModels: !prev.all,
              }))}
            />
            <Checkbox.Item
              label="Anteckningar"
              status={clearSelection.notes ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({ ...prev, all: false, notes: !prev.notes }))}
            />
            <Checkbox.Item
              label="Projektmappar"
              status={clearSelection.projects ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({ ...prev, all: false, projects: !prev.projects }))}
            />
            <Checkbox.Item
              label="Tasklistor"
              status={clearSelection.taskLists ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({ ...prev, all: false, taskLists: !prev.taskLists }))}
            />
            <Checkbox.Item
              label="Tasks"
              status={clearSelection.tasks ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({ ...prev, all: false, tasks: !prev.tasks }))}
            />
            <Checkbox.Item
              label="AI‑modeller"
              status={clearSelection.aiModels ? 'checked' : 'unchecked'}
              onPress={() => setClearSelection(prev => ({ ...prev, all: false, aiModels: !prev.aiModels }))}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setClearDialogVisible(false)}>Avbryt</Button>
            <Button
              onPress={() => {
                setClearDialogVisible(false);
                setConfirmClearVisible(true);
              }}
              disabled={!hasClearSelection}
            >
              Nästa
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmClearVisible} onDismiss={() => setConfirmClearVisible(false)}>
          <Dialog.Title>Rensa valda data?</Dialog.Title>
          <Dialog.Content>
            <Text>Detta tar bort vald data lokalt och kan inte ångras.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmClearVisible(false)}>Avbryt</Button>
            <Button onPress={handleClearLocalData} loading={clearingLocalData}>Rensa</Button>
          </Dialog.Actions>
        </Dialog>
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
