import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Dialog, Button, useTheme, Text, TextInput } from 'react-native-paper';

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
      <Dialog.Title>Backend URL</Dialog.Title>
      <Dialog.Content>
        <TextInput
            label="API URL"
            value={tempUrl}
            onChangeText={setTempUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            mode="outlined"
            style={styles.input}
            placeholder="http://192.168.x.x:3001/api"
        />
        <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>
          Exempel: http://192.168.1.100:3001/api
        </Text>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Avbryt</Button>
        <Button onPress={handleSave}>Spara</Button>
      </Dialog.Actions>
    </Dialog>
  );
};

const styles = StyleSheet.create({
  input: {
    backgroundColor: 'transparent',
  }
});
