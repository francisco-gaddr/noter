import React, { useState } from 'react';
import { Button, Dialog, Portal, TextInput, HelperText } from 'react-native-paper';

interface PasswordModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (password: string) => void;
  error?: string | null;
  loading?: boolean;
  title?: string;
}

export default function PasswordModal({ 
  visible, 
  onDismiss, 
  onSubmit, 
  error, 
  loading,
  title = "Enter Password" 
}: PasswordModalProps) {
  const [password, setPassword] = useState('');

  const handleSubmit = () => {
    onSubmit(password);
    // Don't clear password immediately in case of error, let parent handle
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            error={!!error}
            onSubmitEditing={handleSubmit}
          />
          {error && <HelperText type="error">{error}</HelperText>}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button onPress={handleSubmit} loading={loading} disabled={!password || loading}>
            Unlock
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
