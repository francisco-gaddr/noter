import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Text, useTheme } from 'react-native-paper';
import type { Note } from '@repo/shared';
import { exportNoteToMarkdown, exportNoteToPdf } from '@/services/noteExport';
import { useLongPressMenu, type LongPressAction } from '@/hooks/useLongPressMenu';

/**
 * Long-press menu for a note row. Hosted by NoteList so the menu state
 * is per-list (one open at a time across all rows).
 *
 * Surfaces:
 *   - Share as PDF / Share as Markdown (locked notes refuse via noteExport)
 *   - Delete
 *
 * Visibility filters keep destructive actions out of the menu for locked
 * notes (you must unlock before delete).
 */

export interface NoteContextMenuController {
  onLongPress: (note: Note) => void;
  Modal: React.ComponentType<unknown>;
}

interface ConfigArgs {
  onDelete?: (note: Note) => void;
}

export const useNoteContextMenu = ({ onDelete }: ConfigArgs): NoteContextMenuController => {
  const theme = useTheme();

  const actions: LongPressAction<Note>[] = [
    {
      id: 'share-pdf',
      label: 'Dela som PDF',
      handler: async (note) => {
        // The note export helpers refuse locked notes via a typed error;
        // we surface that to the user as a no-op (the action menu already
        // hid this entry for locked notes — see `visible` below).
        await exportNoteToPdf({
          id: note._id,
          title: note.title || 'Untitled',
          content: typeof note.content === 'string'
            ? note.content
            : JSON.stringify(note.content || {}),
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          locked: !!(note as Note & { locked?: boolean }).locked,
        });
      },
      visible: (note) => !(note as Note & { locked?: boolean }).locked,
    },
    {
      id: 'share-md',
      label: 'Dela som Markdown',
      handler: async (note) => {
        await exportNoteToMarkdown({
          id: note._id,
          title: note.title || 'Untitled',
          content: typeof note.content === 'string' ? note.content : '',
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          locked: !!(note as Note & { locked?: boolean }).locked,
        });
      },
      visible: (note) => !(note as Note & { locked?: boolean }).locked,
    },
    {
      id: 'delete',
      label: 'Ta bort',
      destructive: true,
      handler: (note) => { onDelete?.(note); },
    },
  ];

  const ctl = useLongPressMenu<Note>({ actions });

  const ModalComponent: React.ComponentType<unknown> = () => (
    <Modal visible={ctl.open} transparent animationType="fade" onRequestClose={ctl.close}>
      <Pressable
        style={styles.backdrop}
        onPress={ctl.close}
        accessibilityLabel="Stäng menyn"
        accessibilityRole="button"
      >
        <Surface
          style={[styles.sheet, { backgroundColor: theme.colors.elevation.level3 }]}
          elevation={4}
          // Block backdrop press from reaching us; the surface is a separate
          // interactive surface so taps inside don't dismiss.
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.header}>
            <Text variant="titleMedium" numberOfLines={1} style={{ flex: 1 }}>
              {ctl.selectedItem?.title || 'Untitled note'}
            </Text>
            <IconButton icon="close" onPress={ctl.close} accessibilityLabel="Stäng" />
          </View>
          {ctl.visibleActions.map((action) => (
            <Button
              key={action.id}
              mode={action.destructive ? 'outlined' : 'text'}
              onPress={() => { void ctl.choose(action.id); }}
              textColor={action.destructive ? theme.colors.error : undefined}
              style={styles.action}
              accessibilityLabel={action.label}
            >
              {action.label}
            </Button>
          ))}
        </Surface>
      </Pressable>
    </Modal>
  );

  return { onLongPress: ctl.onLongPress, Modal: ModalComponent };
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  action: {
    marginVertical: 4,
  },
});
