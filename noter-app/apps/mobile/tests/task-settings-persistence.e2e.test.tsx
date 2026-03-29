import React from 'react';
import renderer, { act } from 'react-test-renderer';
import TasksScreen from '../app/(tabs)/tasks';

const mockSetOptions = jest.fn();
const mockGetItem = jest.fn().mockResolvedValue(null);
const mockSetItem = jest.fn().mockResolvedValue(undefined);
const mockMultiSet = jest.fn().mockImplementation(async (entries: [string, string][]) => {
  for (const [key, value] of entries) {
    await mockSetItem(key, value);
  }
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useFocusEffect: (cb: any) => cb(),
  Stack: { Screen: () => null },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: any[]) => mockGetItem(...args),
  setItem: (...args: any[]) => mockSetItem(...args),
  multiSet: (...args: any[]) => mockMultiSet(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-paper', () => {
  const React = require('react');
  const Menu = ({ children }: any) => React.createElement(React.Fragment, null, children);
  (Menu as any).Item = ({ title }: any) => React.createElement('MenuItem', { title });
  const Dialog = ({ children }: any) => React.createElement(React.Fragment, null, children);
  (Dialog as any).Title = ({ children }: any) => React.createElement('DialogTitle', null, children);
  (Dialog as any).Content = ({ children }: any) => React.createElement('DialogContent', null, children);
  (Dialog as any).Actions = ({ children }: any) => React.createElement('DialogActions', null, children);
  return {
    FAB: 'FAB',
    ActivityIndicator: 'ActivityIndicator',
    IconButton: ({ icon }: any) => React.createElement('IconButton', { icon }),
    Menu,
    Divider: 'Divider',
    Text: 'Text',
    Button: 'Button',
    Portal: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Dialog,
    Avatar: 'Avatar',
    Chip: 'Chip',
    TextInput: 'TextInput',
    useTheme: () => ({ colors: { background: '#fff', onSurface: '#111', primary: '#0af' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  ScrollView: 'ScrollView',
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
}));

jest.mock('@/stores/useStore', () => ({
  useStore: (selector?: any) => {
    const state = {
      tasks: [],
      notes: [],
      isLoading: false,
      fetchTasks: jest.fn(),
      fetchNotes: jest.fn(),
      updateTask: jest.fn(),
      reorderTasks: jest.fn(),
      createNote: jest.fn(),
      updateNote: jest.fn(),
      deleteNote: jest.fn(),
      deleteTask: jest.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@/components/TaskList', () => 'TaskList');
jest.mock('@/components/TaskBoard', () => ({ TaskBoard: 'TaskBoard' }));
jest.mock('@/components/TaskTimeline', () => ({ TaskTimeline: 'TaskTimeline' }));
jest.mock('@/components/EditListDialog', () => ({ EditListDialog: 'EditListDialog' }));
jest.mock('@/components/IconPickerModal', () => 'IconPickerModal');
jest.mock('react-native-svg', () => ({ SvgUri: 'SvgUri' }));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

describe('Task settings persistence e2e', () => {
  const flushPendingWork = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
      jest.runAllTimers();
    });
  };

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
  });

  it('läser/sparar uppgiftsfilter och sortering', async () => {
    await act(async () => {
      renderer.create(<TasksScreen />);
    });
    await flushPendingWork();

    expect(mockGetItem).toHaveBeenCalledWith('task_sort');
    expect(mockGetItem).toHaveBeenCalledWith('task_filters');
    expect(mockSetItem).toHaveBeenCalledWith('task_sort', JSON.stringify({ sortBy: 'custom', sortOrder: 'desc' }));
  });

  it('återställer aktivt filter från lagring efter omladdning', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'task_filters') {
        return JSON.stringify({
          quickFilter: 'today',
          statusFilter: 'active',
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-01T23:59:59.999Z',
        });
      }
      if (key === 'task_sort') {
        return JSON.stringify({ sortBy: 'dueDate', sortOrder: 'asc' });
      }
      return null;
    });

    await act(async () => {
      renderer.create(<TasksScreen />);
    });
    await flushPendingWork();

    expect(mockSetItem).toHaveBeenCalledWith('task_sort', JSON.stringify({ sortBy: 'dueDate', sortOrder: 'asc' }));
    expect(mockSetItem).toHaveBeenCalledWith(
      'task_filters',
      expect.stringContaining('"quickFilter":"today"')
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      'task_filters',
      expect.stringContaining('"statusFilter":"active"')
    );
  });
});
