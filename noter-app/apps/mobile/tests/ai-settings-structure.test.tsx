import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AIScreen from '../app/(tabs)/ai';

const mockSetOptions = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-paper', () => {
  const React = require('react');
  const Dialog = (props: any) => React.createElement('Dialog', props, props.visible ? props.children : null);
  Dialog.Title = (props: any) => React.createElement('DialogTitle', props, props.children);
  Dialog.Content = (props: any) => React.createElement('DialogContent', props, props.children);
  Dialog.Actions = (props: any) => React.createElement('DialogActions', props, props.children);
  return {
    Button: ({ children, ...props }: any) => React.createElement('Button', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    IconButton: (props: any) => React.createElement('IconButton', props),
    TextInput: (props: any) => React.createElement('TextInput', props),
    Menu: Object.assign(
      ({ children, ...props }: any) => React.createElement('Menu', props, children),
      { Item: (props: any) => React.createElement('MenuItem', props, props.title) }
    ),
    Switch: (props: any) => React.createElement('Switch', props),
    List: {
      Item: (props: any) => React.createElement('ListItem', props),
      Icon: (props: any) => React.createElement('ListIcon', props),
    },
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    ProgressBar: (props: any) => React.createElement('ProgressBar', props),
    Portal: ({ children }: any) => React.createElement('Portal', null, children),
    Dialog,
    useTheme: () => ({ colors: { background: '#fff', surface: '#fff', outline: '#ccc', outlineVariant: '#ccc', onSurface: '#000', onSurfaceVariant: '#777', primaryContainer: '#eee', surfaceVariant: '#eee' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  Platform: { OS: 'ios', select: (obj: any) => obj.ios },
  NativeModules: { MLCModule: { loadModel: jest.fn(), generate: jest.fn(), unloadModel: jest.fn() } },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');

jest.mock('@/services/database', () => ({
  getModelsLocal: jest.fn().mockResolvedValue([]),
  getConversationsLocal: jest.fn().mockResolvedValue([]),
  getProjectsLocal: jest.fn().mockResolvedValue([]),
  saveProjectLocal: jest.fn(),
  saveConversationLocal: jest.fn(),
  saveMessageLocal: jest.fn(),
}));

jest.mock('@/services/ai/huggingface', () => ({
  searchHuggingFaceModels: jest.fn().mockResolvedValue([]),
  getModelFiles: jest.fn().mockResolvedValue([]),
  getConversionHealth: jest.fn().mockResolvedValue({
    mode: 'external',
    localBinaryAvailable: false,
    storageDir: '/tmp',
    storageWritable: true,
  }),
}));

jest.mock('@/services/ai/modelService', () => ({
  downloadModel: jest.fn(),
  getBestQuantization: jest.fn(),
  deleteModel: jest.fn(),
  cancelDownload: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('token'),
  setItemAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('scope'),
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
}));

jest.mock('@/components/IconPickerModal', () => (props: any) => (
  props.visible ? require('react').createElement('IconPickerModal', props) : null
));

describe('mobile ai settings structure parity', () => {
  it('shows models and instructions tabs in settings mode', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AIScreen />);
      await Promise.resolve();
    });
    const options = mockSetOptions.mock.calls[0][0];
    await act(async () => {
      const right = options.headerRight();
      const toggles = right.props.children.filter((child: any) => child?.props?.icon === 'cog');
      toggles[0].props.onPress();
    });
    expect(tree!.root.findByProps({ testID: 'ai-settings-tab-models' })).toBeTruthy();
    expect(tree!.root.findByProps({ testID: 'ai-settings-tab-instructions' })).toBeTruthy();
    expect(tree!.root.findByProps({ testID: 'ai-open-download-models-dialog' })).toBeTruthy();
  });
});
