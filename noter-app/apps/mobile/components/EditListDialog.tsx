import React, { useState, useEffect } from 'react';
import { Button, Dialog, TextInput, useTheme } from 'react-native-paper';

interface EditListDialogProps {
  visible: boolean;
  initialTitle: string;
  onDismiss: () => void;
  onSave: (newTitle: string) => void;
  onDelete: () => void;
  onChangeIcon: () => void;
}

export const EditListDialog: React.FC<EditListDialogProps> = ({
  visible,
  initialTitle,
  onDismiss,
  onSave,
  onDelete,
  onChangeIcon,
}) => {
  const theme = useTheme();
  const [title, setTitle] = useState(initialTitle);

  // Reset title when dialog opens with new initialTitle
  useEffect(() => {
    if (visible) {
      setTitle(initialTitle);
    }
  }, [visible, initialTitle]);

  const handleSave = () => {
    onSave(title);
  };

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>Ändra listnamn</Dialog.Title>
      <Dialog.Content>
        <TextInput
          label="Namn"
          value={title}
          onChangeText={setTitle}
          mode="outlined"
          autoFocus={true}
        />
        <Button
          mode="outlined"
          onPress={onChangeIcon}
          style={{ marginTop: 16 }}
          icon="emoticon-outline"
        >
          Byt Ikon
        </Button>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Avbryt</Button>
        <Button onPress={onDelete} textColor={theme.colors.error}>
          Ta bort lista
        </Button>
        <Button onPress={handleSave}>Spara</Button>
      </Dialog.Actions>
    </Dialog>
  );
};
