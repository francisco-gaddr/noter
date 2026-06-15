import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, Button, IconButton, TextInput, Menu, useTheme, Divider, Dialog, HelperText } from 'react-native-paper';
import { useStore } from '@/stores/useStore';
import { Note } from '@repo/shared';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { SvgUri } from 'react-native-svg';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

interface ProjectSelectorProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect?: (projectId: string | null) => void;
  selectedProjectId?: string | null;
}

const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  let normalized = value.trim().toLowerCase();
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/\s+/g, '_').replace(/-/g, '_');
  if (normalized === 'projectfolder' || normalized === 'project_folder') return 'project';
  if (normalized.includes('project') || normalized.includes('folder')) return 'project';
  if (normalized === 'folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task-list' || normalized === 'task_list') return 'task_list';
  if (normalized.includes('task') && normalized.includes('list')) return 'task_list';
  return normalized || 'note';
};

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    padding: 20,
    borderRadius: 10,
    maxHeight: '80%',
    alignSelf: 'center',
    width: '90%',
    maxWidth: 500,
  },
  title: {
    marginBottom: 10,
    textAlign: 'center'
  },
  list: {
    maxHeight: 300
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5
  },
  createBtn: {
    marginTop: 10
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10
  }
});

// Extracted component to prevent re-renders losing focus
const CreateProjectInput = React.memo(({ 
  visible, 
  onCancel, 
  onCreate, 
  theme 
}: { 
  visible: boolean, 
  onCancel: () => void, 
  onCreate: (name: string) => void, 
  theme: any 
}) => {
  const [name, setName] = useState('');

  const handleCreate = () => {
    onCreate(name);
    setName('');
  };

  if (!visible) return null;

  return (
    <View style={{ gap: 15 }}>
      <TextInput
        label="Project Name"
        value={name}
        onChangeText={setName}
        mode="outlined"
        autoFocus
      />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
        <Button onPress={onCancel}>Cancel</Button>
        <Button mode="contained" onPress={handleCreate}>Create</Button>
      </View>
    </View>
  );
});

const RenameProjectInput = React.memo(({
  visible,
  initialName,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initialName: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) => {
  const [name, setName] = useState(initialName);

  React.useEffect(() => {
    if (visible) {
      setName(initialName);
    }
  }, [visible, initialName]);

  if (!visible) return null;

  return (
    <View style={{ gap: 15 }}>
      <TextInput
        label="Name"
        value={name}
        onChangeText={setName}
        mode="outlined"
        autoCorrect={false}
        autoFocus
      />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
        <Button onPress={onCancel}>Cancel</Button>
        <Button mode="contained" onPress={() => onSave(name)}>Save</Button>
      </View>
    </View>
  );
});

export default function ProjectSelector({ visible, onDismiss, onSelect, selectedProjectId }: ProjectSelectorProps) {
  const { notes, activeProjectId, setActiveProject, createNote, updateNote, deleteNote, verifyNoteLock, reorderNotes } = useStore();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const isSwedish = i18n.language?.toLowerCase().startsWith('sv');
  
  const [isCreating, setIsCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<Note | null>(null);
  
  // Menu state for action button
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number, y: number } | null>(null);
  const [selectedProjectForMenu, setSelectedProjectForMenu] = useState<Note | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [lockDialogVisible, setLockDialogVisible] = useState(false);
  const [unlockDialogVisible, setUnlockDialogVisible] = useState(false);
  const [projectPassword, setProjectPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [pendingSelectProjectId, setPendingSelectProjectId] = useState<string | null>(null);
  const unlockPasswordRef = useRef<any>(null);
  
  const renderProjectIcon = (iconKey?: string) => {
    if (!iconKey) return <IconButton icon="folder-outline" size={24} />;
    if (iconKey.startsWith('Fa')) {
      const name = iconKey.startsWith('Fa') ? iconKey.substring(2) : iconKey;
      const fa5Name = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      return (
        <View style={{ width: 40, alignItems: 'center' }}>
          <FontAwesome5 name={fa5Name as any} size={20} color={theme.colors.onSurface} />
        </View>
      );
    }
    return (
      <View style={{ width: 40, alignItems: 'center' }}>
        <SvgUri uri={iconKey} width={20} height={20} />
      </View>
    );
  };

  const projects = useMemo(() => notes.filter((n) => normalizeNoteType((n as any).type) === 'project')
    .sort((a, b) => {
      const ao = Number((a as any).order ?? 0);
      const bo = Number((b as any).order ?? 0);
      return ao - bo;
    }), [notes]);

  useEffect(() => {
    if (!unlockDialogVisible) return;
    const timer = setTimeout(() => {
      if (unlockPasswordRef.current && typeof unlockPasswordRef.current.focus === 'function') {
        unlockPasswordRef.current.focus();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [unlockDialogVisible]);

  const currentSelected = selectedProjectId !== undefined ? selectedProjectId : activeProjectId;

  const handleSelect = (id: string | null) => {
    if (id) {
      const selected = projects.find((project) => project._id === id);
      if (selected?.locked) {
        setPendingSelectProjectId(id);
        setUnlockDialogVisible(true);
        return;
      }
    }
    if (onSelect) {
        onSelect(id);
    } else {
        setActiveProject(id);
    }
    onDismiss();
  };

  const handleReorder = async (nextProjects: Note[]) => {
    const payload = nextProjects.map((project, order) => ({ ...project, order, parentId: null }));
    await reorderNotes(payload as any);
  };

  const handleCreateProject = async (name: string) => {
    if (!name.trim()) return;
    try {
      await createNote({
        title: name,
        content: '',
        type: 'project',
        parentId: null
      } as any);
      setIsCreating(false);
    } catch (e) {
      console.error(e);
      alert('Failed to create project');
    }
  };

  const handleUpdate = async (nameInput: string) => {
    if (!editingProject || !nameInput.trim()) return;
    try {
      await updateNote(editingProject._id, { title: nameInput.trim(), type: 'project' });
      setEditingProject(null);
    } catch (e) {
      console.error(e);
      alert('Failed to update project');
    }
  };

  const handleDelete = async () => {
    if (!selectedProjectForMenu) return;
    // Confirm delete?
    try {
      if (activeProjectId === selectedProjectForMenu._id) {
          setActiveProject(null);
      }
      await deleteNote(selectedProjectForMenu._id);
      setMenuVisible(false);
      setSelectedProjectForMenu(null);
    } catch (e) {
      console.error(e);
      alert('Failed to delete project');
    }
  };

  const handleLockProject = async () => {
    if (!selectedProjectForMenu) return;
    if (!projectPassword) return;
    await updateNote(selectedProjectForMenu._id, { locked: true, password: projectPassword, type: 'project' } as any);
    setProjectPassword('');
    setLockDialogVisible(false);
    setMenuVisible(false);
    setSelectedProjectForMenu(null);
  };

  const handleUnlockProject = async () => {
    const targetId = pendingSelectProjectId || selectedProjectForMenu?._id || null;
    if (!targetId || !projectPassword) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      // verifyNoteLock THROWS on a wrong password — previously uncaught, so the dialog
      // just hung silently. Catch it and show a clear "fel lösenord" message instead.
      await verifyNoteLock(targetId, projectPassword);
    } catch (e: any) {
      setUnlockError(t('note.incorrectPassword', 'Felaktigt lösenord'));
      return;
    } finally {
      setUnlocking(false);
    }
    setProjectPassword('');
    setUnlockError(null);
    setUnlockDialogVisible(false);
    if (pendingSelectProjectId) {
      if (onSelect) onSelect(pendingSelectProjectId);
      else setActiveProject(pendingSelectProjectId);
      onDismiss();
      setPendingSelectProjectId(null);
    }
    setMenuVisible(false);
    setSelectedProjectForMenu(null);
  };

  const openMenu = (event: any, project: Note) => {
      const { nativeEvent } = event;
      const nextAnchor = { x: nativeEvent.pageX, y: nativeEvent.pageY };
      setSelectedProjectForMenu(project);
      setMenuAnchor(null);
      setMenuVisible(false);
      setTimeout(() => {
          setMenuAnchor(nextAnchor);
          setMenuVisible(true);
      }, 50);
  };

  return (
    <Portal>
      <Modal 
        visible={visible} 
        onDismiss={onDismiss} 
        contentContainerStyle={[
            styles.modal, 
            { backgroundColor: theme.colors.surface, alignSelf: 'center' }
        ]}
        style={{ justifyContent: 'center', alignItems: 'center' }}
      >
        {isCreating ? (
           <View>
              <Text variant="headlineSmall" style={styles.title}>Create Project</Text>
              <CreateProjectInput 
                visible={isCreating} 
                onCancel={() => setIsCreating(false)} 
                onCreate={handleCreateProject}
                theme={theme}
              />
           </View>
        ) : (
          <>
            <Text variant="headlineSmall" style={styles.title}>Projects</Text>
            
            <View style={styles.list}>
              <TouchableOpacity
                style={[
                  styles.item,
                  currentSelected === null && { backgroundColor: theme.colors.secondaryContainer }
                ]}
                onPress={() => handleSelect(null)}
                testID="project-row-all-notes"
              >
                <IconButton icon="folder-multiple-outline" size={24} />
                <Text variant="bodyLarge">All Notes</Text>
                {currentSelected === null && <IconButton icon="check" size={20} />}
              </TouchableOpacity>
              
              <Divider style={{ marginVertical: 5 }} />
              <DraggableFlatList
                data={projects}
                keyExtractor={(item) => item._id}
                style={{ maxHeight: 260 }}
                containerStyle={{ paddingBottom: 130 }}
                // Breathing room so the last folder never sits flush against the footer.
                contentContainerStyle={{ paddingBottom: 16 }}
                activationDistance={8}
                onDragEnd={({ data }) => handleReorder(data as Note[])}
                renderItem={({ item, drag, isActive }: RenderItemParams<Note>) => (
                  <TouchableOpacity
                    key={item._id}
                    style={[
                      styles.item,
                      currentSelected === item._id && { backgroundColor: theme.colors.secondaryContainer },
                      isActive ? { opacity: 0.85 } : null,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      handleSelect(item._id);
                    }}
                    testID={`project-row-${item._id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Project: ${item.title || 'Untitled'}`}
                    accessibilityHint="Double-tap to select. Long-press to reorder."
                    accessibilityState={{ selected: currentSelected === item._id }}
                    onLongPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      drag();
                    }}
                    delayLongPress={180}
                  >
                    {renderProjectIcon((item as any).icon)}
                    <Text variant="bodyLarge" style={{ flex: 1 }}>{item.title}</Text>
                    <IconButton
                      icon="dots-horizontal"
                      size={20}
                      onPress={(e) => openMenu(e, item)}
                    />
                    {currentSelected === item._id && <IconButton icon="check" size={20} />}
                  </TouchableOpacity>
                )}
              />
            </View>

            <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant, backgroundColor: theme.colors.elevation.level2, marginHorizontal: -20, marginBottom: -20, paddingHorizontal: 20, paddingBottom: 20 }]}>
              <Button mode="outlined" onPress={() => setIsCreating(true)} icon="plus">
                {isSwedish ? 'Nytt projekt' : 'New Project'}
              </Button>
              <Button onPress={onDismiss}>{isSwedish ? 'Stäng' : 'Close'}</Button>
            </View>
          </>
        )}

        {/* Rename Dialog */}
        <Portal>
            <Dialog visible={!!editingProject} onDismiss={() => setEditingProject(null)}>
                <Dialog.Title>Rename Project</Dialog.Title>
                <Dialog.Content>
                    <RenameProjectInput
                      visible={!!editingProject}
                      initialName={editingProject?.title || ''}
                      onCancel={() => setEditingProject(null)}
                      onSave={handleUpdate}
                    />
                </Dialog.Content>
            </Dialog>
        </Portal>


        {/* Context Menu */}
        <Menu
            visible={menuVisible}
            onDismiss={() => {
                setMenuVisible(false);
                setMenuAnchor(null);
            }}
            anchor={menuAnchor || { x: 0, y: 0 }}
        >
            <Menu.Item 
                onPress={() => {
                    setMenuVisible(false);
                    setMenuAnchor(null);
                    if (selectedProjectForMenu) {
                        setIconPickerOpen(true);
                    }
                }} 
                title="Change Icon" 
                leadingIcon="emoticon-outline"
            />
            <Menu.Item 
                onPress={() => {
                    setMenuVisible(false);
                    setMenuAnchor(null);
                    if (selectedProjectForMenu) {
                        setEditingProject(selectedProjectForMenu);
                    }
                }} 
                title="Rename" 
                leadingIcon="pencil"
            />
            <Menu.Item 
                onPress={() => {
                    setProjectPassword('');
                    if (selectedProjectForMenu?.locked) {
                        setUnlockDialogVisible(true);
                    } else {
                        setLockDialogVisible(true);
                    }
                }} 
                title={selectedProjectForMenu?.locked ? 'Unlock' : 'Lock'}
                leadingIcon={selectedProjectForMenu?.locked ? 'lock-open-outline' : 'lock-outline'}
            />
            <Menu.Item 
                onPress={handleDelete} 
                title="Delete" 
                leadingIcon="delete"
                titleStyle={{ color: theme.colors.error }}
            />
        </Menu>

        <Dialog visible={lockDialogVisible} onDismiss={() => setLockDialogVisible(false)}>
          <Dialog.Title>Lock Project</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Password"
              secureTextEntry
              value={projectPassword}
              onChangeText={setProjectPassword}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLockDialogVisible(false)}>Cancel</Button>
            <Button mode="contained" onPress={handleLockProject} disabled={!projectPassword}>Lock</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={unlockDialogVisible} onDismiss={() => { setUnlockDialogVisible(false); setUnlockError(null); }}>
          <Dialog.Title>{t('noteEditor.unlockNoteTitle', 'Lås upp projekt')}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              ref={unlockPasswordRef}
              mode="outlined"
              label={t('auth.password', 'Lösenord')}
              secureTextEntry
              value={projectPassword}
              onChangeText={(v) => { setProjectPassword(v); if (unlockError) setUnlockError(null); }}
              error={!!unlockError}
              autoFocus
              onSubmitEditing={handleUnlockProject}
              testID="unlock-project-password-input"
            />
            {unlockError && <HelperText type="error" visible>{unlockError}</HelperText>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => {
              setUnlockDialogVisible(false);
              setUnlockError(null);
              setPendingSelectProjectId(null);
            }}>{t('common.cancel', 'Avbryt')}</Button>
            <Button mode="contained" loading={unlocking} onPress={handleUnlockProject} disabled={!projectPassword || unlocking}>{t('noteEditor.unlockNote', 'Lås upp')}</Button>
          </Dialog.Actions>
        </Dialog>

        {isCreating ? <Button onPress={onDismiss} style={{ marginTop: 10 }}>Close</Button> : null}

        {selectedProjectForMenu && (
            <IconPickerModal
                visible={iconPickerOpen}
                onDismiss={() => setIconPickerOpen(false)}
                onSelect={async (icon) => {
                    if (selectedProjectForMenu) {
                        await updateNote(selectedProjectForMenu._id, { icon });
                        setIconPickerOpen(false);
                        setSelectedProjectForMenu(null);
                    }
                }}
                currentIcon={(selectedProjectForMenu as any)?.icon}
            />
        )}
      </Modal>
    </Portal>
  );
}
