import React, { useEffect, useState, useRef, useMemo } from 'react';
import { StyleSheet, View, TextInput, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView, Keyboard, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Appbar, useTheme, Text, Menu, Button } from 'react-native-paper';
import { FontAwesome5 } from '@expo/vector-icons';
import { SvgUri } from 'react-native-svg';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useStore } from '@/stores/useStore';
import { CreateNoteDto, UpdateNoteDto } from '@repo/shared';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import PasswordModal from '@/components/PasswordModal';
import { tiptapJsonToHtml } from '@/utils/tiptap';
import { getVideoEmbedHtml } from '@/utils/video';
import IconPickerModal from '@/components/IconPickerModal';
import ProjectSelector from '@/components/ProjectSelector';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '@/services/ai/security';
import { getReadableProtectedText } from '@/utils/protectedNote';

export default function NoteEditorScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; parentId?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const parentId = Array.isArray(params.parentId) ? params.parentId[0] : params.parentId;
  const router = useRouter();
  const theme = useTheme();
  const { notes, createNote, updateNote, deleteNote, fetchNotes, verifyNoteLock, maskLockedNote, unlockedProtectedNoteIds } = useStore();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  
  const richText = useRef<RichEditor>(null);
  
  const isNew = id === 'new';
  const existingNote = id ? notes.find(n => n._id === id) : undefined;
  const blockingLockedAncestor = useMemo(() => {
    if (!existingNote) return null;
    return findBlockingLockedAncestor(existingNote as any, buildSecurityNoteMap(notes as any), new Set(unlockedProtectedNoteIds));
  }, [existingNote, notes, unlockedProtectedNoteIds]);

  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<string>('');
  const [iconColor, setIconColor] = useState<string | undefined>(undefined);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [initialHtml, setInitialHtml] = useState(''); // Only used to initialize the editor
  const contentRef = useRef<string>('');
  const [editorKey, setEditorKey] = useState<string>(() => `editor-${String(id ?? 'new')}-${Date.now()}`);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const tagsRef = useRef<string[]>([]);

  // Lock State
  const [isLocked, setIsLocked] = useState(false);
  const isLockedRef = useRef(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'unlock' | 'lock'>('unlock');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Video Modal State
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [tagsInput, setTagsInput] = useState('');

  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  const initializedNoteIdRef = useRef<string | null>(null);
  const userEditedRef = useRef(false);
  const hydratedFingerprintRef = useRef<string>('');

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
  const iconColorRef = useRef(iconColor);
  const selectedParentIdRef = useRef(selectedParentId);
  
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { iconRef.current = icon; }, [icon]);
  useEffect(() => { iconColorRef.current = iconColor; }, [iconColor]);
  useEffect(() => { selectedParentIdRef.current = selectedParentId; }, [selectedParentId]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);

  // Auto-save on unmount
  useEffect(() => {
    return () => {
      // If manually deleted, explicitly saving, or already successfully saved manually, skip
      if (isDeletedRef.current || isSavingRef.current || hasSavedRef.current) return;
      if (isLockedRef.current) return;
      
      const currentContent = contentRef.current;
      const currentTitle = titleRef.current;
      const currentIcon = iconRef.current;
      const currentIconColor = iconColorRef.current;
      const currentParentId = selectedParentIdRef.current;
      const currentTags = tagsRef.current;

      // If it's a new note and empty (no title, no content), don't create it
      if (isNew && !currentTitle.trim() && !currentContent.trim()) {
          return;
      }
      
      // Fire and forget save
      const save = async () => {
        try {
            let titleToSave = currentTitle.trim();
            if (!titleToSave && !currentContent) titleToSave = t('common.untitled');
            
            // If still empty (no title, no content), skip
            if (!titleToSave && !currentContent) return;

            if (isNew) {
           // Create
           await createNote({
             title: titleToSave,
             content: currentContent,
             parentId: currentParentId,
             tags: currentTags,
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
                 tags: currentTags,
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
    return () => {
      if (!isNew && existingNote?.locked && id) {
        maskLockedNote(id);
      }
    };
  }, [id, existingNote?.locked, isNew, maskLockedNote]);

  useEffect(() => {
    if (!isNew && existingNote) {
      const fingerprint = `${String(id ?? '')}|${String(existingNote.updatedAt ?? '')}|${String(existingNote.title ?? '')}|${String(existingNote.content ?? '')}|${blockingLockedAncestor ? 'locked' : 'open'}`;
      if (initializedNoteIdRef.current === id && hydratedFingerprintRef.current === fingerprint) return;
      if (initializedNoteIdRef.current === id && userEditedRef.current) return;
      if (blockingLockedAncestor) {
        setIsLocked(true);
        setShowPasswordModal(true);
        setTitle(existingNote.title);
        setIcon(existingNote.icon || '');
        setIconColor(existingNote.iconColor);
        setSelectedParentId(existingNote.parentId || null);
      } else {
        const rawContent = (existingNote as any).__rawEncryptedContent || existingNote.content;
        const rawTitle = (existingNote as any).__rawEncryptedTitle || existingNote.title;
        
        const decryptedContent = getReadableProtectedText(rawContent, existingNote.content, '');
        const decryptedTitle = getReadableProtectedText(rawTitle, existingNote.title, '');

        const html = typeof decryptedContent === 'string' && /<\/?[a-z][\s\S]*>/i.test(decryptedContent) 
          ? decryptedContent 
          : tiptapJsonToHtml(decryptedContent);
        setTitle(decryptedTitle);
        setIcon(existingNote.icon || '');
        setIconColor(existingNote.iconColor);
        setInitialHtml(html);
        contentRef.current = html;
        setEditorKey(`editor-${String(id)}-${Date.now()}`);
        setSelectedParentId(existingNote.parentId || null);
        setTags(existingNote.tags || []);
      }
      hydratedFingerprintRef.current = fingerprint;
      initializedNoteIdRef.current = id ?? null;
      userEditedRef.current = false;
    } else if (!isNew && !existingNote) {
      fetchNotes(); 
    } else if (isNew) {
      setTitle('');
      setIcon('');
      setIconColor(undefined);
      setInitialHtml('');
      contentRef.current = '';
      setEditorKey(`editor-${String(id ?? 'new')}-${Date.now()}`);
      setSelectedParentId(parentId || null);
      setTags([]);
      initializedNoteIdRef.current = id ?? null;
      hydratedFingerprintRef.current = '';
      userEditedRef.current = false;
    }
  }, [id, existingNote, isNew, parentId, blockingLockedAncestor]);

  // Helper to generate title if missing
  const getEffectiveTitle = (title: string, content: string) => {
    if (title && title.trim()) return title.trim();
    const plainText = content.replace(/<[^>]*>?/gm, '').trim();
    if (plainText) {
      const words = plainText.split(/\s+/);
      const title = words.slice(0, 5).join(' ');
      return title.length > 30 ? title.substring(0, 30) + '...' : title;
    }
    return t('common.untitled');
  };

  const handleTitleChange = (text: string) => {
    userEditedRef.current = true;
    setTitle(text);
  };

  const handleContentChange = (html: string) => {
    userEditedRef.current = true;
    contentRef.current = html;
  };

  const normalizeTags = (input: string) => {
    const parts = input
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    return Array.from(new Set(parts));
  };

  const openTagsModal = () => {
    setTagsInput(tags.join(', '));
    setShowTagsModal(true);
  };

  const handleSaveTags = async () => {
    const nextTags = normalizeTags(tagsInput);
    setTags(nextTags);
    setShowTagsModal(false);
    if (!isNew && id) {
      try {
        await updateNote(id, { tags: nextTags });
      } catch {}
    }
  };

  const handleManualSave = async () => {
    // Generate title if missing, but allow user to have no title if they want
    let titleToSave = title.trim();
    
    // Only force a title if absolutely nothing is present to avoid creating "ghost" notes
    if (!titleToSave && !contentRef.current) {
      titleToSave = t('common.untitled'); 
    }
    // If we have content but no title, titleToSave remains "" (empty string)

    setIsSaving(true);
    isSavingRef.current = true;
    try {
      if (isNew) {
        const dto: CreateNoteDto = { 
          title: titleToSave, 
          content: contentRef.current || '', 
          tags, 
          icon,
          iconColor,
          parentId: selectedParentId,
          type: 'note'
        };
        await createNote(dto);
      } else {
        const dto: UpdateNoteDto = { title: titleToSave, content: contentRef.current || '', tags, icon, iconColor, parentId: selectedParentId || undefined };
        await updateNote(id!, dto);
      }
      setLastSaved(new Date());
      hasSavedRef.current = true;
      router.back();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
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
      t('note.deleteConfirmTitle'),
      t('note.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { 
          text: t('common.delete'), 
          style: 'destructive', 
          onPress: async () => {
            try {
              isDeletedRef.current = true;
              await deleteNote(id!);
              router.back();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
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
        const result = await verifyNoteLock(id!, password);
        const decryptedContent = getReadableProtectedText(result.content, '', '');
        const html = typeof decryptedContent === 'string' && /<\/?[a-z][\s\S]*>/i.test(decryptedContent)
          ? decryptedContent
          : tiptapJsonToHtml(decryptedContent);
        setInitialHtml(html);
        contentRef.current = html;
        setTitle(getReadableProtectedText(result.title, '', ''));
        setEditorKey(`editor-${String(id)}-${Date.now()}`);
        setIsLocked(false);
        setShowPasswordModal(false);
      } else {
        // Locking the note
        await updateNote(id!, { locked: true, password });
        Alert.alert(t('common.success'), t('note.lockedSuccess'));
        setShowPasswordModal(false);
        router.back(); // Go back after locking, or stay and require unlock? Let's go back.
      }
    } catch (error: any) {
      setUnlockError(passwordMode === 'unlock' ? t('note.incorrectPassword') : error.message);
    } finally {
      setUnlocking(false);
    }
  };

  const handleRemoveLock = async () => {
    try {
      await updateNote(id!, { locked: false, password: '' });
      Alert.alert(t('common.success'), t('note.lockRemoved'));
      setShowMenu(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const handleInsertImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert(t('note.imagePermission'));
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
      Alert.alert(t('note.tableNotFound'));
      return;
    }
    const tableHtml = match[0];
    const updated = mutate(tableHtml);
    if (!updated) {
      Alert.alert(t('note.tableUpdateError'));
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
    const iframe = getVideoEmbedHtml(videoUrl);
    if (!iframe) return;
    richText.current?.insertHTML(iframe);
    setVideoUrl('');
    setShowVideoModal(false);
  };

  if (isLocked) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Appbar.Header>
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title={t('note.locked')} />
        </Appbar.Header>
        <View style={styles.lockedContainer}>
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>
            {blockingLockedAncestor && existingNote && blockingLockedAncestor._id !== existingNote._id
              ? (t('note.lockedInherited') || 'Den här anteckningen ligger i en låst projektmapp.')
              : t('note.lockedMessage')}
          </Text>
          <Text variant="bodySmall" style={{ marginBottom: 12, color: theme.colors.onSurfaceVariant }}>
            Krypterat lokalt tills rätt lösenord anges.
          </Text>
          <Button mode="contained" onPress={() => { setPasswordMode('unlock'); setShowPasswordModal(true); }}>
            {t('note.unlock')}
          </Button>
        </View>
        <PasswordModal
          visible={showPasswordModal}
          onDismiss={() => { setShowPasswordModal(false); }}
          onSubmit={handleUnlock}
          error={unlockError}
          loading={unlocking}
          title={t('note.enterPassword')}
          submitLabel={t('note.unlock')}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Appbar.Header
        statusBarHeight={insets.top}
        style={{ height: insets.top + 26, paddingBottom: 5, paddingTop: 0, marginBottom: 5 }}
      >
        <Appbar.BackAction onPress={() => router.back()} />
        {icon && (
          <Pressable
            onLongPress={() => setShowIconPicker(true)}
            style={({pressed}) => ({ justifyContent: 'center', marginLeft: 8, opacity: pressed ? 0.7 : 1 })}
          >
            {icon.startsWith('Fa') ? (
              <FontAwesome5
                name={icon.slice(2).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}
                size={20}
                color={iconColor || theme.colors.onSurface}
              />
            ) : (
              <SvgUri uri={icon} width={20} height={20} />
            )}
          </Pressable>
        )}
        <TextInput
            ref={titleInputRef}
            style={{ 
                flex: 1, 
                fontSize: 20, 
                color: theme.colors.onSurface,
                fontWeight: 'bold',
                marginLeft: 8,
                backgroundColor: 'transparent'
            }}
            value={title}
            onChangeText={handleTitleChange}
            placeholder={t('common.title')}
            placeholderTextColor={theme.colors.onSurfaceDisabled}
        />
        {isSaving && <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginRight: 8 }} />}
        <Menu
          visible={showMenu}
          onDismiss={() => setShowMenu(false)}
          anchor={<Appbar.Action icon="dots-vertical" onPress={() => {
            setShowMenu(false);
            setTimeout(() => setShowMenu(true), 0);
          }} />}
        >
          <Menu.Item
            onPress={() => {
              setShowMenu(false);
              setShowIconPicker(true);
            }}
            title={t('note.changeIcon')}
            leadingIcon="shape-outline"
          />
          <Menu.Item
            onPress={() => {
              setShowMenu(false);
              setShowProjectSelector(true);
            }}
            title={t('note.moveToProject')}
            leadingIcon="folder-outline"
          />
          <Menu.Item
            onPress={() => {
              setShowMenu(false);
              openTagsModal();
            }}
            title={t('note.editTags')}
            leadingIcon="tag-outline"
          />
          {!isNew && (
            <Menu.Item 
              onPress={() => { 
                if (existingNote?.locked && (!blockingLockedAncestor || blockingLockedAncestor._id === existingNote._id)) {
                  handleRemoveLock();
                } else {
                  setPasswordMode('lock'); 
                  setShowPasswordModal(true); 
                  setShowMenu(false); 
                }
              }} 
              title={existingNote?.locked ? t('note.removeLock') : t('note.lock')} 
              leadingIcon={existingNote?.locked ? "lock-open" : "lock"} 
            />
          )}
          {!isNew && (
            <Menu.Item onPress={handleDelete} title={t('common.delete')} leadingIcon="delete" titleStyle={{ color: theme.colors.error }} />
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
            placeholder={t('note.editorPlaceholder')}
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
          insertVideo={handleInsertVideo}
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
        title={passwordMode === 'lock' ? t('note.setPassword') : t('note.enterPassword')}
        submitLabel={passwordMode === 'lock' ? t('note.lock') : t('note.unlock')}
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
        onSelect={(nextIcon, nextColor) => {
          console.log('Selected icon:', nextIcon, 'color:', nextColor);
          setIcon(nextIcon);
          setIconColor(nextColor);
          setShowIconPicker(false);
        }}
        currentIcon={icon}
        currentColor={iconColor}
      />

      <Modal
        visible={showTagsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTagsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowTagsModal(false)}>
          <Pressable
            style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
            onPress={() => {}}
            onStartShouldSetResponder={() => true}
          >
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>{t('note.editTags')}</Text>
            <TextInput
              style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
              placeholder={t('note.tagsPlaceholder')}
              placeholderTextColor={theme.colors.onSurfaceDisabled}
              value={tagsInput}
              onChangeText={setTagsInput}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Button onPress={() => setShowTagsModal(false)} style={{ marginRight: 8 }}>{t('common.cancel')}</Button>
              <Button mode="contained" onPress={handleSaveTags}>{t('common.save')}</Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Video URL Modal */}
      <Modal
        visible={showVideoModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowVideoModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowVideoModal(false)}>
          <Pressable
            style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
            onPress={() => {}}
            onStartShouldSetResponder={() => true}
          >
            <Text variant="titleMedium" style={{ marginBottom: 16 }}>{t('note.insertVideoTitle')}</Text>
            <TextInput
              style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
              placeholder={t('note.insertVideoPlaceholder')}
              placeholderTextColor={theme.colors.onSurfaceDisabled}
              value={videoUrl}
              onChangeText={setVideoUrl}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Button onPress={() => setShowVideoModal(false)} style={{ marginRight: 8 }}>{t('common.cancel')}</Button>
              <Button mode="contained" onPress={submitVideo}>{t('note.insertVideoAction')}</Button>
            </View>
          </Pressable>
        </Pressable>
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
    paddingHorizontal: 16,
    paddingTop: 5,
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
