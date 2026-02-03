import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, Surface, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useStore } from '@/stores/useStore';

export default function RegisterScreen() {
  console.log('RegisterScreen: Mounted');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { register } = useStore();
  const theme = useTheme();

  const handleRegister = async () => {
    if (!username || !password) {
      alert('Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await register(username, password);
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Registration failed');
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
