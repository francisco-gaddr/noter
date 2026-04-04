import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Dialog, Button, useTheme, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

interface BackendUrlDialogProps {
  visible: boolean;
  onDismiss: () => void;
  currentUrl: string;
  onSave: (url: string) => void;
}

export const BackendUrlDialog: React.FC<BackendUrlDialogProps> = ({
  visible,
  onDismiss,
  currentUrl,
  onSave,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [tempUrl, setTempUrl] = useState(currentUrl);

  // Reset tempUrl when dialog opens
  useEffect(() => {
    if (visible) {
      setTempUrl(currentUrl);
    }
  }, [visible, currentUrl]);

  const handleSave = () => {
    onSave(tempUrl);
  };

  return (
    <Dialog visible={visible} onDismiss={onDismiss} style={{ backgroundColor: theme.colors.elevation.level3 }}>
      <Dialog.Title>{t('settings.backendUrl')}</Dialog.Title>
      <Dialog.Content>
        <TextInput
            label={t('settings.apiUrl')}
            value={tempUrl}
            onChangeText={setTempUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            mode="outlined"
            style={styles.input}
            placeholder={t('settings.apiUrlPlaceholder')}
        />
        <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>
          {t('settings.apiUrlExample')}
        </Text>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        <Button onPress={handleSave}>{t('common.save')}</Button>
      </Dialog.Actions>
    </Dialog>
  );
};

const styles = StyleSheet.create({
  input: {
    backgroundColor: 'transparent',
  }
});
