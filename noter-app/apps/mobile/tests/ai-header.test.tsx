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
  const Dialog = (props: any) => React.createElement('Dialog', props, props.children);
  Dialog.Title = (props: any) => React.createElement('DialogTitle', props, props.children);
  Dialog.Content = (props: any) => React.createElement('DialogContent', props, props.children);
  Dialog.Actions = (props: any) => React.createElement('DialogActions', props, props.children);
  return {
    Button: ({ children }: any) => React.createElement('Button', null, children),
    Text: 'Text',
    TextInput: (props: any) => React.createElement('TextInput', props),
    IconButton: ({ icon }: any) => React.createElement('IconButton', { icon }),
    List: { Item: 'ListItem', Icon: 'ListIcon' },
    ActivityIndicator: 'ActivityIndicator',
    ProgressBar: 'ProgressBar',
    Portal: ({ children }: any) => React.createElement('Portal', null, children),
    Dialog,
    useTheme: () => ({ colors: { background: '#fff', surface: '#fff', outline: '#ccc', onSurface: '#000', onSurfaceVariant: '#777', primaryContainer: '#eee', surfaceVariant: '#eee' } }),
  };
});

jest.mock('@/components/IconPickerModal', () => () => null);

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: 'View',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios', select: (obj: any) => obj.ios },
  NativeModules: { MLCModule: { loadModel: jest.fn(), generate: jest.fn(), unloadModel: jest.fn() } },
  AppState: { addEventListener: jest.fn() },
}));

jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');

jest.mock('@/services/database', () => ({
  getModelsLocal: jest.fn().mockResolvedValue([]),
  getConversationsLocal: jest.fn().mockResolvedValue([]),
  getProjectsLocal: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/ai/huggingface', () => ({
  searchHuggingFaceModels: jest.fn().mockResolvedValue([]),
  getModelFiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/ai/modelService', () => ({
  downloadModel: jest.fn(),
  getBestQuantization: jest.fn(),
  deleteModel: jest.fn(),
  cancelDownload: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe.skip('AIScreen header', () => {
  beforeEach(() => {
    mockSetOptions.mockClear();
  });

  it('sets headerLeft and headerRight with menu and new chat', async () => {
    await act(async () => {
      renderer.create(<AIScreen />);
      await Promise.resolve();
    });
    expect(mockSetOptions).toHaveBeenCalled();
    const options = mockSetOptions.mock.calls[0][0];
    expect(String(options.headerLeft)).toContain('menu');
    const headerRightSource = String(options.headerRight);
    expect(headerRightSource).toContain('plus');
    expect(headerRightSource).toContain('cog');
  });
});
