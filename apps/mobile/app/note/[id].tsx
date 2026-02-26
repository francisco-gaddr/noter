import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, TextInput, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView, Keyboard, Pressable, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Appbar, useTheme, Text, Menu, Button } from 'react-native-paper';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { CreateNoteDto, UpdateNoteDto } from '@repo/shared';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import PasswordModal from '@/components/PasswordModal';
import { tiptapJsonToHtml, noteContentToPlainText } from '@/utils/tiptap';
import IconPickerModal from '@/components/IconPickerModal';
import ProjectSelector from '@/components/ProjectSelector';
import i18n from '@/lib/i18n';

export default function NoteEditorScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; parentId?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const parentId = Array.isArray(params.parentId) ? params.parentId[0] : params.parentId;
  const router = useRouter();
  const theme = useTheme();
  const { notes, createNote, updateNote, deleteNote, fetchNotes, verifyNoteLock } = useStore();
  const t = i18n.t.bind(i18n);
  
  const richText = useRef<RichEditor>(null);
  
  const isNew = id === 'new';
  const existingNote = id ? notes.find(n => n._id === id) : undefined;

  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<string>('');
  const [iconColor, setIconColor] = useState<string>('#2196F3');
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

  const escapeHtml = (input: string) =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const toSafeHtml = (content: any) => {
    try {
      if (!content) return '';
      // Quick check to avoid passing obviously bad data
      if (typeof content === 'object' && !Array.isArray(content) && !content.type && !content.content) {
         // It might be a Slate JSON, let tiptapJsonToHtml handle it or try text extraction
      }
      
      const html = tiptapJsonToHtml(content);
      if (typeof html === 'string' && html.length <= 200000) return html;
      return '<p>Content too large to display</p>';
    } catch (err) {
      console.warn('Failed to convert content to safe HTML', err);
    }
    try {
        const text = noteContentToPlainText(content);
        if (!text) return '';
        const trimmed = text.length > 200000 ? text.slice(0, 200000) : text;
        return `<p>${escapeHtml(trimmed)}</p>`;
    } catch {
        return '<p>Error loading content</p>';
    }
  };
  
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
  const iconColorRef = useRef(iconColor);
  const selectedParentIdRef = useRef(selectedParentId);
  
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { iconRef.current = icon; }, [icon]);
  useEffect(() => { iconColorRef.current = iconColor; }, [iconColor]);
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
      const currentIconColor = iconColorRef.current;
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
             iconColor: currentIconColor,
             type: 'note'
           });
        } else {
               // Update
               await updateNote(id!, {
                 title: titleToSave,
                 content: currentContent,
                 parentId: currentParentId,
                 icon: currentIcon,
                 iconColor: currentIconColor
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
        setIconColor((existingNote as any).iconColor || '#2196F3');
        setInitialHtml('');
        contentRef.current = '';
        setSelectedParentId(existingNote.parentId || null);
      } else {
        const html = toSafeHtml(existingNote.content);
        setTitle(existingNote.title);
        setIcon(existingNote.icon || '');
        setIconColor((existingNote as any).iconColor || '#2196F3');
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
      setIconColor('#2196F3');
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
    const withTargets = html.replace(/<a\s+href="([^"]+)"(?![^>]*\btarget=)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer"');
    contentRef.current = withTargets;
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
          iconColor,
          parentId: selectedParentId
        };
        await createNote(dto);
      } else {
        const dto: UpdateNoteDto = { title: titleToSave, content: contentRef.current || '', icon, iconColor, parentId: selectedParentId || undefined };
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
        const html = toSafeHtml(decryptedContent);
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

  const tableCellStyle = 'border: 1px solid #ccc; padding: 8px;';

  const updateTableHtml = async (mutate: (tableHtml: string) => string | null) => {
    const editor = richText.current as any;
    if (!editor?.getContentHtml || !editor?.setContentHTML) return;
    const html = await editor.getContentHtml();
    if (!html) return;
    const match = html.match(/<table[\s\S]*?<\/table>/i);
    if (!match) {
      Alert.alert('No table found');
      return;
    }
    const tableHtml = match[0];
    const updated = mutate(tableHtml);
    if (!updated) {
      Alert.alert('Cannot update table');
      return;
    }
    const nextHtml = html.replace(tableHtml, updated);
    editor.setContentHTML(nextHtml);
    contentRef.current = nextHtml;
  };

  const buildTableRow = (columns: number) => {
    const cells = Array.from({ length: columns }, () => `<td style="${tableCellStyle}"><br></td>`).join('');
    return `<tr>${cells}</tr>`;
  };

  const addTableRow = async () => {
    await updateTableHtml((tableHtml) => {
      const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      const columns = Math.max(
        1,
        ...rows.map((row) => (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).length)
      );
      const newRow = buildTableRow(columns);
      if (tableHtml.includes('</tbody>')) {
        return tableHtml.replace('</tbody>', `${newRow}</tbody>`);
      }
      return tableHtml.replace('</table>', `${newRow}</table>`);
    });
  };

  const removeTableRow = async () => {
    await updateTableHtml((tableHtml) => {
      const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      if (rows.length <= 1) return null;
      const lastRow = rows[rows.length - 1];
      const lastIndex = tableHtml.lastIndexOf(lastRow);
      if (lastIndex === -1) return null;
      return tableHtml.slice(0, lastIndex) + tableHtml.slice(lastIndex + lastRow.length);
    });
  };

  const addTableColumn = async () => {
    await updateTableHtml((tableHtml) => {
      const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      if (!rows.length) return null;
      const updatedRows = rows.map((row) => row.replace(/<\/tr>$/i, `<td style="${tableCellStyle}"><br></td></tr>`));
      let rowIndex = 0;
      return tableHtml.replace(/<tr[\s\S]*?<\/tr>/gi, () => updatedRows[rowIndex++] ?? '');
    });
  };

  const removeTableColumn = async () => {
    await updateTableHtml((tableHtml) => {
      const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      if (!rows.length) return null;
      const updatedRows = rows.map((row) => {
        const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
        if (cells.length <= 1) return null;
        const trOpen = row.match(/<tr[^>]*>/i)?.[0] ?? '<tr>';
        return `${trOpen}${cells.slice(0, -1).join('')}</tr>`;
      });
      if (updatedRows.some((row) => row === null)) return null;
      let rowIndex = 0;
      return tableHtml.replace(/<tr[\s\S]*?<\/tr>/gi, () => updatedRows[rowIndex++] ?? '');
    });
  };

  const insertTable = () => {
    richText.current?.insertHTML(`
      <table style="width:100%; border-collapse: collapse; border: 1px solid #ccc;">
        <tr>
          <td style="${tableCellStyle}">Cell 1</td>
          <td style="${tableCellStyle}">Cell 2</td>
        </tr>
        <tr>
          <td style="${tableCellStyle}">Cell 3</td>
          <td style="${tableCellStyle}">Cell 4</td>
        </tr>
      </table>
    `);
  };

  const submitVideo = () => {
    if (!videoUrl) return;
    const url = videoUrl.trim();
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      richText.current?.insertHTML(
        `<div class="video-container">
           <iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
         </div>`
      );
    } else {
      const isTikTok = (() => {
        try {
          return /(^|\.)tiktok\.com$/i.test(new URL(url).hostname);
        } catch {
          return false;
        }
      })();
      if (isTikTok) {
        void (async () => {
          try {
            const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            if (data && typeof data.html === 'string') {
              richText.current?.insertHTML(data.html);
              return;
            }
          } catch {}
          richText.current?.insertVideo(url);
        })();
      } else {
        richText.current?.insertVideo(url);
      }
    }
    setShowVideoModal(false);
    setVideoUrl('');
  };

  if (isLocked) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Appbar.Header>
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title={t('lockedNote')} />
        </Appbar.Header>
        <View style={styles.lockedContainer}>
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>{t('thisNoteLocked')}</Text>
          <Button mode="contained" onPress={() => { setPasswordMode('unlock'); setShowPasswordModal(true); }}>
            {t('unlockNote')}
          </Button>
        </View>
        <PasswordModal
          visible={showPasswordModal}
          onDismiss={() => { setShowPasswordModal(false); }}
          onSubmit={handleUnlock}
          error={unlockError}
          loading={unlocking}
          title={t('enterPasswordToUnlock')}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        {icon && (
          <Appbar.Action 
            icon={() => {
              if (icon.startsWith('Fa')) {
                const name = icon.startsWith('Fa') ? icon.substring(2) : icon;
                const fa5Name = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
                const IconComponent = require('@expo/vector-icons/FontAwesome5').default;
                return <IconComponent name={fa5Name as any} size={20} color={iconColor || theme.colors.onSurface} />;
              }
              return <MaterialCommunityIcons name="file-document-outline" size={20} color={iconColor || theme.colors.onSurface} />;
            }}
            onPress={() => setShowIconPicker(true)}
          />
        )}
        <View style={{ flex: 1, marginHorizontal: 8 }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={isNew ? 'Ny anteckning' : 'Anteckningstitel'}
            style={[
              styles.titleInput, 
              { 
                color: theme.colors.onSurface, 
                fontSize: 20, 
                fontWeight: '600',
                textAlign: 'left'
              }
            ]}
            onBlur={handleManualSave}
            onSubmitEditing={handleManualSave}
            returnKeyType="done"
          />
          {lastSaved && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -2 }}>
              Sparad {lastSaved.toLocaleTimeString()}
            </Text>
          )}
          {isSaving && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -2 }}>
              Sparar...
            </Text>
          )}
        </View>
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
            <Menu.Item onPress={handleDelete} title="Ta bort" leadingIcon="delete" />
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
              title={existingNote?.locked ? "Ta bort lås" : "Lås anteckning"} 
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
        <RichEditor
            key={editorKey}
            ref={richText}
            initialContentHTML={initialHtml}
            onChange={handleContentChange}
            placeholder="Börja skriva..."
            onLinkPress={(url: string) => {
              if (url) Linking.openURL(url);
            }}
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
            'addTableRow',
            'addTableColumn',
            'removeTableRow',
            'removeTableColumn',
          ]}
          onPressAddImage={handleInsertImage}
          onPressAddVideo={handleInsertVideo}
          iconMap={{
              insertTable: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>Tbl</Text>,
              addTableRow: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>R+</Text>,
              addTableColumn: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>C+</Text>,
              removeTableRow: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>R-</Text>,
              removeTableColumn: ({ tintColor }: any) => <Text style={{ color: tintColor, fontWeight: 'bold' }}>C-</Text>
          }}
          insertTable={insertTable}
          addTableRow={addTableRow}
          addTableColumn={addTableColumn}
          removeTableRow={removeTableRow}
          removeTableColumn={removeTableColumn}
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
        onSelect={(nextIcon, color) => {
          setIcon(nextIcon);
          if (color) setIconColor(color);
          setShowIconPicker(false);
        }}
        currentIcon={icon}
        currentColor={iconColor}
      />
      <Modal
        visible={showVideoModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowVideoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>Infoga video-URL</Text>
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
