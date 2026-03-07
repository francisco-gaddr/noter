import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, Snackbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { useTranslation } from 'react-i18next';

export default function RegisterScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  const router = useRouter();
  const { register } = useStore();
  const theme = useTheme();
  const { t } = useTranslation();

  const handleRegister = async () => {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername || !password) {
        setErrorMessage(t('auth.fillAllFields'));
        setErrorVisible(true);
        return;
    }
    if (password.length < 8) {
        setErrorMessage(t('auth.passwordMinLength'));
        setErrorVisible(true);
        return;
    }
    if (password !== confirmPassword) {
        setErrorMessage(t('auth.passwordsNoMatch'));
        setErrorVisible(true);
        return;
    }

    setLoading(true);
    try {
      await register(normalizedUsername, password);
      // Register usually logs in automatically or returns token, handled in store.
      // If successful, router should redirect via _layout auth guard.
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || t('auth.registrationFailed'));
      setErrorVisible(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium" style={styles.title}>{t('auth.createAccount')}</Text>
        
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

        <TextInput
          label={t('auth.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          style={styles.input}
        />
        
        <Button 
          mode="contained" 
          onPress={handleRegister} 
          loading={loading}
          style={styles.button}
        >
          {t('auth.signup')}
        </Button>

        <Button 
          mode="text" 
          onPress={() => router.back()} 
          style={styles.textButton}
        >
          {t('auth.alreadyHaveAccount')}
        </Button>
      </Surface>

      <Snackbar
        visible={errorVisible}
        onDismiss={() => setErrorVisible(false)}
        action={{
          label: t('common.ok'),
          onPress: () => setErrorVisible(false),
        }}
      >
        {errorMessage}
      </Snackbar>
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
    paddingVertical: 5,
  },
  textButton: {
    marginTop: 10,
  },
});
