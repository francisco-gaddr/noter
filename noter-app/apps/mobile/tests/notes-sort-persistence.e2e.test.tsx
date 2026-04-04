import React from 'react';
import renderer, { act } from 'react-test-renderer';
import NotesScreen from '../app/(tabs)/index';
import { createMockStoreState } from './helpers/mockUseStore';

const mockSetOptions = jest.fn();
const mockGetItem = jest.fn().mockResolvedValue(null);
const mockSetItem = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useFocusEffect: (cb: any) => cb(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: any[]) => mockGetItem(...args),
  setItem: (...args: any[]) => mockSetItem(...args),
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
    useTheme: () => ({ colors: { background: '#fff', onSurface: '#111' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  Alert: { alert: jest.fn() },
}));

const mockStoreState = createMockStoreState({
  notes: [],
  isLoading: false,
  isRefreshingNotes: false,
  error: null,
  fetchNotes: jest.fn(),
  viewMode: 'list',
  setViewMode: jest.fn(),
  activeProjectId: null,
  updateNote: jest.fn(),
  reorderNotes: jest.fn(),
  deleteNote: jest.fn(),
});

jest.mock('@/stores/useStore', () => ({
  ...require('./helpers/mockUseStore').createSelectorStoreMock(() => mockStoreState),
}));

jest.mock('@/components/NoteList', () => 'NoteList');
jest.mock('@/components/ProjectSelector', () => 'ProjectSelector');
jest.mock('@/components/IconPickerModal', () => 'IconPickerModal');
jest.mock('react-native-svg', () => ({ SvgUri: 'SvgUri' }));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');

describe('Notes sort persistence e2e', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('läser och sparar sorteringsinställning för anteckningar', async () => {
    await act(async () => {
      renderer.create(<NotesScreen />);
    });

    expect(mockGetItem).toHaveBeenCalledWith('notes_sort_settings');
    expect(mockSetItem).toHaveBeenCalledWith(
      'notes_sort_settings',
      JSON.stringify({ sortBy: 'createdAt', sortOrder: 'desc' })
    );
  });
});
