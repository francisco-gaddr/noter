import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, Button, IconButton, TextInput, Menu, useTheme, Divider, Dialog } from 'react-native-paper';
import { useStore } from '@/stores/useStore';
import { Note } from '@repo/shared';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { SvgUri } from 'react-native-svg';

interface ProjectSelectorProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect?: (projectId: string | null) => void;
  selectedProjectId?: string | null;
}

export default function ProjectSelector({ visible, onDismiss, onSelect, selectedProjectId }: ProjectSelectorProps) {
  const { notes, activeProjectId, setActiveProject, createNote, updateNote, deleteNote } = useStore();
  const theme = useTheme();
  
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProject, setEditingProject] = useState<Note | null>(null);
  const [editName, setEditName] = useState('');
  
  // Menu state for long press
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number, y: number } | null>(null);
  const [selectedProjectForMenu, setSelectedProjectForMenu] = useState<Note | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  
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

  const projects = notes.filter(n => (n as any).type === 'project')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  const currentSelected = selectedProjectId !== undefined ? selectedProjectId : activeProjectId;

  const handleSelect = (id: string | null) => {
    if (onSelect) {
        onSelect(id);
    } else {
        setActiveProject(id);
    }
    onDismiss();
  };

  const handleCreate = async () => {
    if (!newProjectName.trim()) return;
    try {
      await createNote({
        title: newProjectName,
        content: '',
        type: 'project',
        parentId: null
      } as any);
      setNewProjectName('');
      setIsCreating(false);
    } catch (e) {
      console.error(e);
      alert('Failed to create project');
    }
  };

  const handleUpdate = async () => {
    if (!editingProject || !editName.trim()) return;
    try {
      await updateNote(editingProject._id, { title: editName });
      setEditingProject(null);
      setEditName('');
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
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
        <Text variant="headlineSmall" style={styles.title}>Projects</Text>
        
        <ScrollView style={styles.list}>
          <TouchableOpacity
            style={[
              styles.item,
              currentSelected === null && { backgroundColor: theme.colors.secondaryContainer }
            ]}
            onPress={() => handleSelect(null)}
          >
            <IconButton icon="folder-multiple-outline" size={24} />
            <Text variant="bodyLarge">All Notes</Text>
            {currentSelected === null && <IconButton icon="check" size={20} />}
          </TouchableOpacity>
          
          <Divider style={{ marginVertical: 5 }} />

          {projects.map(project => (
            <TouchableOpacity
              key={project._id}
              style={[
                styles.item,
                currentSelected === project._id && { backgroundColor: theme.colors.secondaryContainer }
              ]}
              onPress={() => handleSelect(project._id)}
              onLongPress={(e) => openMenu(e, project)}
            >
              {renderProjectIcon((project as any).icon)}
              <Text variant="bodyLarge" style={{ flex: 1 }}>{project.title}</Text>
              {currentSelected === project._id && <IconButton icon="check" size={20} />}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {isCreating ? (
          <View style={styles.inputContainer}>
            <TextInput
              label="Project Name"
              value={newProjectName}
              onChangeText={setNewProjectName}
              style={{ flex: 1 }}
              autoFocus
            />
            <IconButton icon="check" onPress={handleCreate} />
            <IconButton icon="close" onPress={() => setIsCreating(false)} />
          </View>
        ) : (
          <Button mode="outlined" onPress={() => setIsCreating(true)} icon="plus" style={styles.createBtn}>
            New Project
          </Button>
        )}

        {/* Rename Dialog */}
        <Portal>
            <Dialog visible={!!editingProject} onDismiss={() => setEditingProject(null)}>
                <Dialog.Title>Rename Project</Dialog.Title>
                <Dialog.Content>
                    <TextInput
                        label="Name"
                        value={editName}
                        onChangeText={setEditName}
                    />
                </Dialog.Content>
                <Dialog.Actions>
                    <Button onPress={() => setEditingProject(null)}>Cancel</Button>
                    <Button onPress={handleUpdate}>Save</Button>
                </Dialog.Actions>
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
                    // We need to trigger Icon Picker.
                    // But Icon Picker is not part of this component structure easily without state.
                    // We can add state for it.
                    if (selectedProjectForMenu) {
                        setIconPickerOpen(true);
                        // We keep selectedProjectForMenu as the target
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
                        setEditName(selectedProjectForMenu.title);
                    }
                }} 
                title="Rename" 
                leadingIcon="pencil"
            />
            <Menu.Item 
                onPress={handleDelete} 
                title="Delete" 
                leadingIcon="delete"
                titleStyle={{ color: theme.colors.error }}
            />
        </Menu>

        <Button onPress={onDismiss} style={{ marginTop: 10 }}>Close</Button>

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

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    padding: 20,
    borderRadius: 10,
    maxHeight: '80%'
  },
  title: {
    marginBottom: 10,
    textAlign: 'center'
  },
  list: {
    maxHeight: 300
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
