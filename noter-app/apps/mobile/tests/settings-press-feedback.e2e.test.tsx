import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SettingsScreen from '../app/(tabs)/settings';
import { createMockStoreState } from './helpers/mockUseStore';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockRouterPush }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: jest.fn() } }),
}));

jest.mock('@/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: jest.fn() }),
}));

const mockStoreState = createMockStoreState({
  setToken: jest.fn(),
  fetchNotes: jest.fn(),
  fetchTasks: jest.fn(),
  setActiveProject: jest.fn(),
  notificationsEnabled: true,
  setNotificationsEnabled: jest.fn(),
  backgroundRefresh: jest.fn(),
});

jest.mock('@/stores/useStore', () => ({
  ...require('./helpers/mockUseStore').createSelectorStoreMock(() => mockStoreState),
}));

jest.mock('@/services/api', () => ({
  API_URL: 'http://localhost:3001/api',
  setApiUrl: jest.fn(),
  getAuthToken: jest.fn(),
}));

jest.mock('@/services/socket', () => ({
  disconnectSocket: jest.fn(),
  initSocket: jest.fn(),
}));

jest.mock('@/services/database', () => ({
  clearLocalData: jest.fn(),
  clearNotesLocal: jest.fn(),
  clearTasksLocal: jest.fn(),
  clearModelsLocal: jest.fn(),
  clearSyncQueue: jest.fn(),
  getModelsLocal: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/ai/modelService', () => ({
  deleteModel: jest.fn(),
}));

jest.mock('@/components/BackendUrlDialog', () => ({
  BackendUrlDialog: () => null,
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.0.0', ios: { buildNumber: '1' }, android: { versionCode: 1 } },
}));

jest.mock('react-native-svg', () => ({ SvgXml: 'SvgXml' }));

jest.mock('react-native-paper', () => {
  const React = require('react');
  const Dialog = (props: any) => React.createElement('Dialog', props, props.visible ? props.children : null);
  Dialog.Title = (props: any) => React.createElement('DialogTitle', props, props.children);
  Dialog.Content = (props: any) => React.createElement('DialogContent', props, props.children);
  Dialog.Actions = (props: any) => React.createElement('DialogActions', props, props.children);
  return {
    List: {
      Item: (props: any) => React.createElement('ListItem', props),
      Icon: (props: any) => React.createElement('ListIcon', props),
      Section: (props: any) => React.createElement('ListSection', props, props.children),
    },
    Switch: (props: any) => React.createElement('Switch', props),
    Text: (props: any) => React.createElement('Text', props, props.children),
    Divider: (props: any) => React.createElement('Divider', props),
    Menu: (props: any) => React.createElement('Menu', props, props.children),
    Dialog,
    Portal: (props: any) => React.createElement('Portal', props, props.children),
    Button: (props: any) => React.createElement('Button', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props),
    RadioButton: { Group: (props: any) => React.createElement('RadioGroup', props, props.children), Item: (props: any) => React.createElement('RadioItem', props) },
    Checkbox: { Item: (props: any) => React.createElement('CheckboxItem', props) },
    useTheme: () => ({ dark: false, colors: { background: '#fff', onSurface: '#000', onSurfaceVariant: '#666' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  ScrollView: 'ScrollView',
  Pressable: (props: any) => require('react').createElement('PressableMock', props, props.children),
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
}));

describe('Settings press feedback', () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

  it('applies press feedback configuration on settings rows', () => {
    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<SettingsScreen />);
    });
    if (!tree) throw new Error('Missing renderer instance');
    const row = (tree.root as any)
      .findAll((node: any) => node.type === 'ListItem')
      .find((node: any) => typeof node.props?.rippleColor === 'string');
    expect(row).toBeTruthy();
    expect((row as any).props.rippleColor).toContain('rgba');
  });

  it('visar lock-alternativen 3h, 5h och 8h', () => {
    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<SettingsScreen />);
    });
    if (!tree) throw new Error('Missing renderer instance');

    const lockItem = (tree.root as any)
      .findAll((node: any) => node.type === 'ListItem')
      .find((node: any) => node.props?.title === 'settings.autoLock');
    expect(lockItem).toBeTruthy();

    act(() => {
      lockItem.props.onPress();
    });

    const values = (tree.root as any)
      .findAll((node: any) => node.type === 'RadioItem')
      .map((node: any) => node.props.value);
    expect(values).toContain('3h');
    expect(values).toContain('5h');
    expect(values).toContain('8h');
  });

  it('öppnar prestandasnapshots från utvecklarsektionen', () => {
    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<SettingsScreen />);
    });
    if (!tree) throw new Error('Missing renderer instance');

    const performanceItem = (tree.root as any)
      .findAll((node: any) => node.type === 'ListItem')
      .find((node: any) => node.props?.title === 'settings.performanceSnapshotsTitle');
    expect(performanceItem).toBeTruthy();

    act(() => {
      performanceItem.props.onPress();
    });

    expect(mockRouterPush).toHaveBeenCalledWith('/performance-snapshots');
  });
});
