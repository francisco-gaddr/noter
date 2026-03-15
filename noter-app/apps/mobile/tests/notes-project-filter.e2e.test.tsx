import React from 'react';
import renderer, { act } from 'react-test-renderer';
import NotesScreen from '../app/(tabs)/index';

const mockSetOptions = jest.fn();
let capturedNoteListProps: any = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useFocusEffect: (cb: any) => cb(),
}));

jest.mock('react-native-paper', () => {
  const React = require('react');
  const Menu = ({ children }: any) => React.createElement(React.Fragment, null, children);
  (Menu as any).Item = ({ title }: any) => React.createElement('MenuItem', { title });
  return {
    FAB: 'FAB',
    ActivityIndicator: 'ActivityIndicator',
    IconButton: ({ icon, onPress }: any) => React.createElement('IconButton', { icon, onPress }),
    Menu,
    Divider: 'Divider',
    Text: ({ children }: any) => React.createElement('Text', null, children),
    Button: ({ children, onPress }: any) => React.createElement('Button', { onPress }, children),
    Avatar: 'Avatar',
    useTheme: () => ({ colors: { background: '#fff' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  TouchableOpacity: ({ children, onPress }: any) => {
    const React = require('react');
    return React.createElement('TouchableOpacity', { onPress }, children);
  },
  Alert: { alert: jest.fn() },
}));

jest.mock('@/stores/useStore', () => ({
  useStore: () => ({
    notes: [
      { _id: 'p1', title: 'Projekt A', type: 'project-folder', parentId: null, content: '', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'n1', title: 'Anteckning 1', type: 'note', parentId: 'p1', content: '', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'n2', title: 'Anteckning 2', type: 'note', parentId: '"p1"', content: '', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'n4', title: 'Anteckning 3', type: 'note', parentId: "'\"p1\"'", content: '', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'n3', title: 'Utanför projekt', type: 'note', parentId: null, content: '', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ],
    isLoading: false,
    error: null,
    fetchNotes: jest.fn(),
    viewMode: 'list',
    setViewMode: jest.fn(),
    activeProjectId: '"p1"',
    updateNote: jest.fn(),
    reorderNotes: jest.fn(),
    deleteNote: jest.fn(),
  }),
}));

jest.mock('@/components/NoteList', () => (props: any) => {
  const React = require('react');
  capturedNoteListProps = props;
  return React.createElement('NoteList', props);
});
jest.mock('@/components/ProjectSelector', () => 'ProjectSelector');
jest.mock('@/components/IconPickerModal', () => 'IconPickerModal');
jest.mock('react-native-svg', () => ({ SvgUri: 'SvgUri' }));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('Notes project filtering e2e', () => {
  beforeEach(() => {
    capturedNoteListProps = null;
    mockSetOptions.mockClear();
  });

  it('visar anteckningar i valt projekt även när parentId har citattecken', async () => {
    await act(async () => {
      renderer.create(<NotesScreen />);
    });

    const titles = (capturedNoteListProps?.notes || []).map((n: any) => n.title).sort();
    expect(titles).toEqual(['Anteckning 1', 'Anteckning 2', 'Anteckning 3']);
  });
});
