import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, IconButton, Portal } from 'react-native-paper';
import { Link, useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { API_URL, setApiUrl } from '@/services/api';
import { BackendUrlDialog } from '@/components/BackendUrlDialog';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useStore();
  const theme = useTheme();

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState(API_URL);
  const [activeApiUrl, setActiveApiUrl] = useState(API_URL);

  useEffect(() => {
    setTempApiUrl(API_URL);
    setActiveApiUrl(API_URL);
  }, [showSettings]);

  const handleLogin = async () => {
    if (!username || !password) return;
    setLoading(true);
    try {
      await login(username, password);
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || 'Login failed');
      setErrorVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
      await setApiUrl(tempApiUrl);
      setActiveApiUrl(tempApiUrl);
      setShowSettings(false);
      // alert('Server URL updated. You may need to restart the app if issues persist.');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium" style={styles.title}>Welcome Back</Text>
        
        <TextInput
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          style={styles.input}
        />
        
        <TextInput
          label="Password"
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
          Login
        </Button>

        <Button 
          mode="text" 
          onPress={() => router.push('/auth/register' as any)} 
          style={styles.textButton}
        >
          Don't have an account? Sign up
        </Button>

        <IconButton 
            icon="cog" 
            onPress={() => setShowSettings(true)} 
            style={{ marginTop: 20 }}
        />
        
        <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.outline, textAlign: 'center' }}>
          Server: {activeApiUrl}
        </Text>
      </Surface>

      <Portal>
        <BackendUrlDialog 
            visible={showSettings}
            onDismiss={() => setShowSettings(false)}
            currentUrl={currentApiUrl}
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
