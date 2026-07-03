import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SettingsScreen from '../app/(tabs)/settings';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: jest.fn() } }),
}));

jest.mock('@/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: jest.fn() }),
}));

jest.mock('@/stores/useStore', () => {
  const state = {
    setToken: jest.fn(),
    fetchNotes: jest.fn(),
    fetchTasks: jest.fn(),
    setActiveProject: jest.fn(),
    notificationsEnabled: true,
    setNotificationsEnabled: jest.fn(),
    backgroundRefresh: jest.fn(),
    syncOfflineChanges: jest.fn(),
    isOffline: false,
    isSyncingOffline: false,
    notes: [],
    tasks: [],
    unlockedProtectedNoteIds: [],
    syncingCount: 0,
  };
  const useStore: any = (selector?: any) => (selector ? selector(state) : state);
  useStore.getState = () => state;
  return { useStore };
});

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
      Subheader: (props: any) => React.createElement('ListSubheader', props, props.children),
      Accordion: (props: any) => React.createElement('ListAccordion', props, props.children),
    },
    IconButton: (props: any) => React.createElement('IconButton', props),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Switch: (props: any) => React.createElement('Switch', props),
    Text: (props: any) => React.createElement('Text', props, props.children),
    Divider: (props: any) => React.createElement('Divider', props),
    Menu: Object.assign(
      (props: any) => React.createElement('Menu', props, props.children),
      { Item: (props: any) => React.createElement('MenuItem', props) }
    ),
    Dialog,
    Portal: (props: any) => React.createElement('Portal', props, props.children),
    Button: (props: any) => React.createElement('Button', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props),
    RadioButton: { Group: (props: any) => React.createElement('RadioGroup', props, props.children), Item: (props: any) => React.createElement('RadioItem', props) },
    Checkbox: Object.assign(
      (props: any) => React.createElement('Checkbox', props),
      { Item: (props: any) => React.createElement('CheckboxItem', props) }
    ),
    useTheme: () => ({
      dark: false,
      colors: {
        background: '#fff', surface: '#fff', onSurface: '#000', onSurfaceVariant: '#666',
        primary: '#0af', outline: '#ccc', outlineVariant: '#ddd', error: '#d00',
        primaryContainer: '#eef', surfaceVariant: '#eee', secondaryContainer: '#e8e8e8',
        elevation: { level0: '#fff', level1: '#f7f7f7', level2: '#f2f2f2', level3: '#ededed', level4: '#e8e8e8', level5: '#e3e3e3' },
      },
    }),
  };
});

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const React = require('react'); // captured now — a deferred render must not require() after teardown
  // Narrow stubs for what the test asserts on + everything REAL via Proxy —
  // a bare stub object breaks Platform/AccessibilityInfo/etc. as the app grows,
  // and eager Object.assign would fire RN's deprecated-module getters.
  const overrides = {
  StyleSheet: { create: () => ({}) },
  View: 'View',
  ScrollView: 'ScrollView',
  Pressable: (props: any) => React.createElement('PressableMock', props, props.children),
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
};
  return new Proxy(overrides, { get: (t: any, p: any) => (p in t ? t[p] : actual[p]) });
});

describe('Settings press feedback', () => {
  it('applies press feedback configuration on settings rows', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    // Async act: the screen kicks off async effects (SecureStore/AsyncStorage/model
    // list); flush them inside act so nothing commits after the test environment
    // is torn down (that intermittently crashed the whole jest worker).
    await act(async () => {
      tree = renderer.create(<SettingsScreen />);
      await Promise.resolve();
    });
    if (!tree) throw new Error('Missing renderer instance');
    // Current behavior: settings rows are List.Item with an explicit rippleColor
    // (the old Pressable/android_ripple implementation no longer exists).
    const pressableRows = tree.root.findAll(
      (node: any) => node.type === 'ListItem' && typeof node.props?.onPress === 'function'
    );
    expect(pressableRows.length).toBeGreaterThan(0);
    for (const row of pressableRows) {
      expect((row as any).props.rippleColor).toBe('rgba(33, 150, 243, 0.40)');
    }
  });
});
