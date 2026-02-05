import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme, Snackbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';

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

  const handleRegister = async () => {
    if (!username || !password) {
        setErrorMessage('Please fill in all fields');
        setErrorVisible(true);
        return;
    }
    if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match');
        setErrorVisible(true);
        return;
    }

    setLoading(true);
    try {
      await register(username, password);
      // Register usually logs in automatically or returns token, handled in store.
      // If successful, router should redirect via _layout auth guard.
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || 'Registration failed');
      setErrorVisible(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium" style={styles.title}>Create Account</Text>
        
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

        <TextInput
          label="Confirm Password"
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
          Sign Up
        </Button>

        <Button 
          mode="text" 
          onPress={() => router.back()} 
          style={styles.textButton}
        >
          Already have an account? Login
        </Button>
      </Surface>

      <Snackbar
        visible={errorVisible}
        onDismiss={() => setErrorVisible(false)}
        action={{
          label: 'OK',
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
