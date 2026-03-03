import React from 'react';
import renderer, { act } from 'react-test-renderer';
import NotesScreen from '../app/(tabs)/index';

const mockSetOptions = jest.fn();

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
    IconButton: ({ icon }: any) => React.createElement('IconButton', { icon }),
    Menu,
    Divider: 'Divider',
    Text: 'Text',
    Button: 'Button',
    Avatar: 'Avatar',
    useTheme: () => ({ colors: { background: '#fff' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  Alert: { alert: jest.fn() },
}));

jest.mock('@/stores/useStore', () => ({
  useStore: () => ({
    notes: [],
    isLoading: false,
    error: null,
    fetchNotes: jest.fn(),
    viewMode: 'list',
    setViewMode: jest.fn(),
    activeProjectId: null,
    updateNote: jest.fn(),
    reorderNotes: jest.fn(),
    deleteNote: jest.fn(),
  }),
}));

jest.mock('@/components/NoteList', () => 'NoteList');
jest.mock('@/components/ProjectSelector', () => 'ProjectSelector');
jest.mock('@/components/IconPickerModal', () => 'IconPickerModal');
jest.mock('react-native-svg', () => ({ SvgUri: 'SvgUri' }));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('NotesScreen header', () => {
  beforeEach(() => {
    mockSetOptions.mockClear();
  });

  it('sets headerRight with search and settings icons', () => {
    act(() => {
      renderer.create(<NotesScreen />);
    });
    expect(mockSetOptions).toHaveBeenCalled();
    const options = mockSetOptions.mock.calls[0][0];
    const source = String(options.headerRight);
    expect(source).toContain('magnify');
    expect(source).toContain('cog');
  });
});
