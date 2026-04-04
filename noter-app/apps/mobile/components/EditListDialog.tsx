import React, { useState, useEffect } from 'react';
import { Button, Dialog, TextInput, useTheme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      <Dialog.Title>{t('tasks.listEditTitle')}</Dialog.Title>
      <Dialog.Content>
        <TextInput
          label={t('tasks.listNameLabel')}
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
          {t('tasks.changeIcon')}
        </Button>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        <Button onPress={onDelete} textColor={theme.colors.error}>
          {t('tasks.deleteList')}
        </Button>
        <Button onPress={handleSave}>{t('common.save')}</Button>
      </Dialog.Actions>
    </Dialog>
  );
};
