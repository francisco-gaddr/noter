import React, { useState, useEffect } from 'react';
import { View, TextInput as RNTextInput, StyleSheet } from 'react-native';
import { Dialog, Portal, Button, useTheme, Text } from 'react-native-paper';

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
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>Backend URL</Dialog.Title>
      <Dialog.Content>
        <View style={[styles.inputContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
          <RNTextInput
            value={tempUrl}
            onChangeText={setTempUrl}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textContentType="URL"
            keyboardType="url"
            style={[styles.input, { color: theme.colors.onSurface }]}
            placeholder="http://..."
            placeholderTextColor={theme.colors.onSurfaceVariant}
          />
        </View>
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
  inputContainer: {
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  input: {
    fontSize: 16,
    height: 24, // Min height
    padding: 0,
  }
});
