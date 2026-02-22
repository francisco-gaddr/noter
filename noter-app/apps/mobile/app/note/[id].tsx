import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, TextInput, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView, Keyboard, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Appbar, useTheme, Text, Menu, Button } from 'react-native-paper';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { CreateNoteDto, UpdateNoteDto } from '@repo/shared';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import PasswordModal from '@/components/PasswordModal';
import { tiptapJsonToHtml } from '@/utils/tiptap';
import IconPickerModal from '@/components/IconPickerModal';
import ProjectSelector from '@/components/ProjectSelector';

export default function NoteEditorScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; parentId?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const parentId = Array.isArray(params.parentId) ? params.parentId[0] : params.parentId;
  const router = useRouter();
  const theme = useTheme();
  const { notes, createNote, updateNote, deleteNote, fetchNotes, verifyNoteLock } = useStore();
  
  const richText = useRef<RichEditor>(null);
  
  const isNew = id === 'new';
  const existingNote = id ? notes.find(n => n._id === id) : undefined;

  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<string>('');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [initialHtml, setInitialHtml] = useState(''); // Only used to initialize the editor
  const contentRef = useRef<string>('');
  const [editorKey, setEditorKey] = useState<string>(() => `editor-${String(id ?? 'new')}-${Date.now()}`);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Lock State
  const [isLocked, setIsLocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'unlock' | 'lock'>('unlock');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Video Modal State
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  const initializedNoteIdRef = useRef<string | null>(null);

  const isDeletedRef = useRef(false);
  const isSavingRef = useRef(false);
  const hasSavedRef = useRef(false);
  
  const titleInputRef = useRef<TextInput>(null);
  const hasFocusedRef = useRef(false);
  
  useEffect(() => {
    if (isNew && !hasFocusedRef.current) {
      // Use a small timeout to ensure layout is done
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
        hasFocusedRef.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isNew]);

  // Keep refs updated
  const titleRef = useRef(title);
  const iconRef = useRef(icon);
  const selectedParentIdRef = useRef(selectedParentId);
  
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { iconRef.current = icon; }, [icon]);
  useEffect(() => { selectedParentIdRef.current = selectedParentId; }, [selectedParentId]);
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);

  // Auto-save on unmount
  useEffect(() => {
    return () => {
      // If manually deleted, explicitly saving, or already successfully saved manually, skip
      if (isDeletedRef.current || isSavingRef.current || hasSavedRef.current) return;
      
      const currentContent = contentRef.current;
      const currentTitle = titleRef.current;
      const currentIcon = iconRef.current;
      const currentParentId = selectedParentIdRef.current;

      // If it's a new note and empty (no title, no content), don't create it
      if (isNew && !currentTitle.trim() && !currentContent.trim()) {
          return;
      }
      
      // Fire and forget save
      const save = async () => {
        try {
            let titleToSave = currentTitle.trim();
            if (!titleToSave && !currentContent) titleToSave = 'Untitled Note';
            
            // If still empty (no title, no content), skip
            if (!titleToSave && !currentContent) return;

            if (isNew) {
           // Create
           await createNote({
             title: titleToSave,
             content: currentContent,
             parentId: currentParentId,
             icon: currentIcon,
             type: 'note'
           });
        } else {
               // Update
               await updateNote(id!, {
                 title: titleToSave,
                 content: currentContent,
                 parentId: currentParentId,
                 icon: currentIcon
               });
            }
        } catch (e) {
            console.error('Auto-save failed', e);
        }
      };
      
      save();
    };
  }, []);

  useEffect(() => {
    if (!isNew && existingNote) {
      if (initializedNoteIdRef.current === id) return;
      if (existingNote.locked) {
        setIsLocked(true);
        setShowPasswordModal(true);
        setTitle(existingNote.title);
        setIcon(existingNote.icon || '');
        setSelectedParentId(existingNote.parentId || null);
      } else {
        const html = tiptapJsonToHtml(existingNote.content);
        setTitle(existingNote.title);
        setIcon(existingNote.icon || '');
        setInitialHtml(html);
        contentRef.current = html;
        setEditorKey(`editor-${String(id)}-${Date.now()}`);
        setSelectedParentId(existingNote.parentId || null);
      }
      initializedNoteIdRef.current = id ?? null;
    } else if (!isNew && !existingNote) {
      fetchNotes(); 
    } else if (isNew) {
      setTitle('');
      setIcon('');
      setInitialHtml('');
      contentRef.current = '';
      setEditorKey(`editor-${String(id ?? 'new')}-${Date.now()}`);
      setSelectedParentId(parentId || null);
      initializedNoteIdRef.current = id ?? null;
    }
  }, [id, existingNote, isNew, parentId]);

  // Helper to generate title if missing
  const getEffectiveTitle = (t: string, c: string) => {
    if (t && t.trim()) return t.trim();
    const plainText = c.replace(/<[^>]*>?/gm, '').trim();
    if (plainText) {
      const words = plainText.split(/\s+/);
      const title = words.slice(0, 5).join(' ');
      return title.length > 30 ? title.substring(0, 30) + '...' : title;
    }
    return 'Untitled Note';
  };

  const handleTitleChange = (text: string) => {
    setTitle(text);
  };

  const handleContentChange = (html: string) => {
    contentRef.current = html;
  };

  const handleManualSave = async () => {
    // Generate title if missing, but allow user to have no title if they want
    let titleToSave = title.trim();
    
    // Only force a title if absolutely nothing is present to avoid creating "ghost" notes
    if (!titleToSave && !contentRef.current) {
      titleToSave = 'Untitled Note'; 
    }
    // If we have content but no title, titleToSave remains "" (empty string)

    setIsSaving(true);
    isSavingRef.current = true;
    try {
      if (isNew) {
        const dto: CreateNoteDto = { 
          title: titleToSave, 
          content: contentRef.current || '', 
          tags: [], 
          icon,
          parentId: selectedParentId
        };
        await createNote(dto);
      } else {
        const dto: UpdateNoteDto = { title: titleToSave, content: contentRef.current || '', icon, parentId: selectedParentId || undefined };
        await updateNote(id!, dto);
      }
      setLastSaved(new Date());
      hasSavedRef.current = true;
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message);
      // If error occurred, allow retry and allow auto-save (although auto-save might also fail if validation error)
      setIsSaving(false);
      isSavingRef.current = false;
    } finally {
      // Don't reset isSaving if successful, to prevent race condition with cleanup
      if (!hasSavedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      'Delete Note',
      'Are you sure you want to delete this note?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              isDeletedRef.current = true;
              await deleteNote(id!);
              router.back();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          }
        },
      ]
    );
  };

  const handleUnlock = async (password: string) => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      if (passwordMode === 'unlock') {
        const decryptedContent = await verifyNoteLock(id!, password);
        const html = tiptapJsonToHtml(decryptedContent);
        setInitialHtml(html);
        contentRef.current = html;
        setEditorKey(`editor-${String(id)}-${Date.now()}`);
        setIsLocked(false);
        setShowPasswordModal(false);
      } else {
        // Locking the note
        await updateNote(id!, { locked: true, password });
        Alert.alert('Success', 'Note locked successfully');
        setShowPasswordModal(false);
        router.back(); // Go back after locking, or stay and require unlock? Let's go back.
      }
    } catch (error: any) {
      setUnlockError(passwordMode === 'unlock' ? 'Incorrect password' : error.message);
    } finally {
      setUnlocking(false);
    }
  };

  const handleRemoveLock = async () => {
    try {
      await updateNote(id!, { locked: false, password: '' });
      Alert.alert('Success', 'Lock removed');
      setShowMenu(false);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleInsertImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert("Permission to access camera roll is required!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      base64: true,
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0].base64) {
      const base64Str = `data:${result.assets[0].mimeType};base64,${result.assets[0].base64}`;
      richText.current?.insertImage(base64Str);
    }
  };

  const handleInsertVideo = () => {
    setShowVideoModal(true);
  };

  const submitVideo = () => {
    if (videoUrl) {
      richText.current?.insertVideo(videoUrl);
      setShowVideoModal(false);
      setVideoUrl('');
    }
  };

  if (isLocked) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Appbar.Header>
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title="Locked Note" />
        </Appbar.Header>
        <View style={styles.lockedContainer}>
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>This note is locked</Text>
          <Button mode="contained" onPress={() => { setPasswordMode('unlock'); setShowPasswordModal(true); }}>
            Unlock Note
          </Button>
        </View>
        <PasswordModal
          visible={showPasswordModal}
          onDismiss={() => { setShowPasswordModal(false); }}
          onSubmit={handleUnlock}
          error={unlockError}
          loading={unlocking}
          title="Enter Password to Unlock"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content 
          title={isNew ? 'New Note' : 'Edit Note'} 
          subtitle={lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : (isSaving ? 'Saving...' : '')}
        />
        <Menu
          visible={showMenu}
          onDismiss={() => setShowMenu(false)}
          anchor={<Appbar.Action icon="dots-vertical" onPress={() => setShowMenu(true)} />}
        >
          <Menu.Item
            onPress={() => {
              setShowMenu(false);
              setShowProjectSelector(true);
            }}
            title="Move to Project"
            leadingIcon="folder-outline"
          />
          <Menu.Item
            onPress={() => {
              setShowMenu(false);
              setShowIconPicker(true);
            }}
            title="Change Icon"
            leadingIcon="shape-outline"
          />
          {!isNew && (
            <Menu.Item onPress={handleDelete} title="Delete" leadingIcon="delete" />
          )}
          {!isNew && (
            <Menu.Item 
              onPress={() => { 
                if (existingNote?.locked) {
                  handleRemoveLock();
                } else {
                  setPasswordMode('lock'); 
                  setShowPasswordModal(true); 
                  setShowMenu(false); 
                }
              }} 
              title={existingNote?.locked ? "Remove Lock" : "Lock Note"} 
              leadingIcon={existingNote?.locked ? "lock-open" : "lock"} 
            />
          )}
        </Menu>
        <Appbar.Action icon="check" onPress={handleManualSave} disabled={isSaving} />
      </Appbar.Header>

      <KeyboardAvoidingView
        style={styles.editorShell}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          style={styles.contentContainer}
          contentContainerStyle={styles.contentContainerInner}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
        >
          <TextInput
          ref={titleInputRef}
          style={[styles.titleInput, { color: theme.colors.onSurface }]}
          placeholder="Title"
          placeholderTextColor={theme.colors.onSurfaceDisabled}
          value={title}
          onChangeText={handleTitleChange}
          returnKeyType="next"
          onSubmitEditing={() => {
            // Small delay to ensure TextInput blur completes and keyboard stays up/transitions
            setTimeout(() => {
                richText.current?.focusContent();
            }, 50);
          }}
          blurOnSubmit={false}
          // autoFocus handled by useEffect to avoid re-focus loops
        />
        <RichEditor
            key={editorKey}
            ref={richText}
            initialContentHTML={initialHtml}
            onChange={handleContentChange}
            placeholder="Start typing..."
            scrollEnabled={false}
            editorStyle={{
              backgroundColor: theme.colors.background,
              color: theme.colors.onBackground,
              placeholderColor: theme.colors.onSurfaceDisabled,
              contentCSSText: `font-size: 16px; color: ${theme.colors.onBackground};`,
            }}
            style={styles.editor}
            useContainer={false}
        />
        </ScrollView>
        <RichToolbar
          editor={richText}
          actions={[
            actions.setBold,
            actions.setItalic,
            actions.setUnderline,
            actions.heading1,
            actions.insertBulletsList,
            actions.insertOrderedList,
            actions.checkboxList,
            actions.insertLink,
            actions.insertImage,
            actions.insertVideo,
            'insertTable',
          ]}
          onPressAddImage={handleInsertImage}
          onPressAddVideo={handleInsertVideo}
          iconMap={{
              insertTable: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>Tbl</Text>
          }}
          insertTable={() => {
              richText.current?.insertHTML(`
                  <table style="width:100%; border-collapse: collapse; border: 1px solid #ccc;">
                      <tr>
                          <td style="border: 1px solid #ccc; padding: 8px;">Cell 1</td>
                          <td style="border: 1px solid #ccc; padding: 8px;">Cell 2</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ccc; padding: 8px;">Cell 3</td>
                          <td style="border: 1px solid #ccc; padding: 8px;">Cell 4</td>
                      </tr>
                  </table>
                  <br/>
              `);
          }}
          iconTint={theme.colors.onSurface}
          selectedIconTint={theme.colors.primary}
          style={[styles.toolbar, { backgroundColor: theme.colors.elevation.level2 }]}
        />
      </KeyboardAvoidingView>

      <PasswordModal
        visible={showPasswordModal}
        onDismiss={() => setShowPasswordModal(false)}
        onSubmit={handleUnlock}
        error={unlockError}
        loading={unlocking}
        title={passwordMode === 'lock' ? "Set Password" : "Enter Password"}
      />

      <ProjectSelector
        visible={showProjectSelector}
        onDismiss={() => setShowProjectSelector(false)}
        onSelect={setSelectedParentId}
        selectedProjectId={selectedParentId}
      />

      <IconPickerModal
        visible={showIconPicker}
        onDismiss={() => setShowIconPicker(false)}
        onSelect={(nextIcon) => {
          setIcon(nextIcon);
          setShowIconPicker(false);
        }}
        currentIcon={icon}
      />

      {/* Video URL Modal */}
      <Modal
        visible={showVideoModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowVideoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>Insert Video URL</Text>
            <TextInput
              style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
              placeholder="https://youtube.com/..."
              placeholderTextColor={theme.colors.onSurfaceDisabled}
              value={videoUrl}
              onChangeText={setVideoUrl}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Button onPress={() => setShowVideoModal(false)} style={{ marginRight: 8 }}>Cancel</Button>
              <Button mode="contained" onPress={submitVideo}>Insert</Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  editorShell: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  contentContainer: {
    flex: 1,
  },
  contentContainerInner: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 16,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  editor: {
    flex: 1,
    minHeight: 300,
  },
  toolbar: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    padding: 20,
    borderRadius: 8,
    elevation: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
