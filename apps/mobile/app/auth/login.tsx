import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, Portal, Dialog, IconButton, Snackbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { API_URL, setApiUrl } from '@/services/api';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
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
        <Dialog visible={showSettings} onDismiss={() => setShowSettings(false)}>
            <Dialog.Title>Server Settings</Dialog.Title>
            <Dialog.Content>
                <Text variant="bodyMedium" style={{marginBottom: 10}}>
                    Enter the backend API URL. 
                    For physical device, use your computer's local IP (e.g. http://192.168.1.5:3001/api).
                </Text>
                <TextInput
                    label="API URL"
                    value={tempApiUrl}
                    onChangeText={setTempApiUrl}
                    autoCapitalize="none"
                    keyboardType="url"
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={() => setShowSettings(false)}>Cancel</Button>
                <Button onPress={handleSaveSettings}>Save</Button>
            </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={errorVisible}
        onDismiss={() => setErrorVisible(false)}
        action={{
          label: 'OK',
          onPress: () => setErrorVisible(false),
        }}
        duration={5000}
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
  header: {
      position: 'absolute',
      top: 40,
      right: 20,
      zIndex: 10
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
