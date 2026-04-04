import React, { useState, useEffect } from 'react';
import { Button, Dialog, Portal, TextInput, HelperText } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

interface PasswordModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (password: string) => void;
  error?: string | null;
  loading?: boolean;
  title?: string;
  submitLabel?: string;
}

export default function PasswordModal({ 
  visible, 
  onDismiss, 
  onSubmit, 
  error, 
  loading,
  title,
  submitLabel
}: PasswordModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!visible) {
      setPassword('');
    }
  }, [visible]);

  const handleSubmit = () => {
    onSubmit(password);
    // Don't clear password immediately in case of error, let parent handle
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title || t('passwordModal.enterPassword')}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label={t('common.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCorrect={false}
            autoFocus
            error={!!error}
            onSubmitEditing={handleSubmit}
          />
          {error && <HelperText type="error">{error}</HelperText>}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t('common.cancel')}</Button>
          <Button onPress={handleSubmit} loading={loading} disabled={!password || loading}>
            {submitLabel || t('passwordModal.unlock')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
