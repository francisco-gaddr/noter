import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, IconButton, Portal } from 'react-native-paper';
import { Link, useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { API_URL, setApiUrl } from '@/services/api';
import { BackendUrlDialog } from '@/components/BackendUrlDialog';
import { useTranslation } from 'react-i18next';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const router = useRouter();
  const login = useStore((state) => state.login);
  const theme = useTheme();
  const { t } = useTranslation();

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [activeApiUrl, setActiveApiUrl] = useState(API_URL);

  useEffect(() => {
    setActiveApiUrl(API_URL);
  }, [showSettings]);

  const handleLogin = async () => {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername || !password) return;
    setLoading(true);
    try {
      await login(normalizedUsername, password);
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || t('auth.loginFailed'));
      setErrorVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (url: string) => {
      await setApiUrl(url);
      setActiveApiUrl(url);
      setShowSettings(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium" style={styles.title}>{t('auth.welcomeBack')}</Text>
        {errorVisible && errorMessage ? (
          <Text variant="bodySmall" style={{ color: theme.colors.error, marginBottom: 10 }}>
            {errorMessage}
          </Text>
        ) : null}
        
        <TextInput
          label={t('auth.username')}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          style={styles.input}
        />
        
        <TextInput
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
        />
        
        <Button 
          mode="contained" 
          onPress={handleLogin} 
          loading={loading}
          style={styles.button}
        >
          {t('auth.login')}
        </Button>

        <Button 
          mode="text" 
          onPress={() => router.push('/auth/register' as any)} 
          style={styles.textButton}
        >
          {t('auth.signupPrompt')}
        </Button>

        <IconButton 
            icon="cog" 
            onPress={() => setShowSettings(true)} 
            style={{ marginTop: 20 }}
        />
        
        <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.outline, textAlign: 'center' }}>
          {t('auth.serverLabel')}: {activeApiUrl}
        </Text>
      </Surface>

      <Portal>
        <BackendUrlDialog 
            visible={showSettings}
            onDismiss={() => setShowSettings(false)}
            currentUrl={activeApiUrl}
            onSave={handleSaveSettings}
        />
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  title: {
    marginBottom: 20,
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    marginBottom: 15,
  },
  button: {
    width: '100%',
    marginTop: 10,
  },
  textButton: {
    marginTop: 10,
  }
});
