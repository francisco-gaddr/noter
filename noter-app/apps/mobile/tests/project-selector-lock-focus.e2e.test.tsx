import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ProjectSelector from '../components/ProjectSelector';
import { createMockStoreState } from './helpers/mockUseStore';

const mockFocusSpy = jest.fn();
const mockVerifyNoteLock = jest.fn();

jest.mock('react-native-paper', () => {
  const React = require('react');
  const Portal = ({ children }: any) => React.createElement(React.Fragment, null, children);
  const Modal = ({ children, visible }: any) => React.createElement('Modal', { visible }, visible ? children : null);
  const Dialog = ({ children, visible }: any) => React.createElement('Dialog', { visible }, visible ? children : null);
  Dialog.Title = ({ children }: any) => React.createElement('DialogTitle', null, children);
  Dialog.Content = ({ children }: any) => React.createElement('DialogContent', null, children);
  Dialog.Actions = ({ children }: any) => React.createElement('DialogActions', null, children);
  const Menu = ({ children, visible }: any) => React.createElement('Menu', { visible }, visible ? children : null);
  Menu.Item = ({ onPress, title }: any) => React.createElement('MenuItem', { onPress, title });
  const TextInput = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ focus: mockFocusSpy }));
    return React.createElement('TextInput', props);
  });
  return {
    Portal,
    Modal,
    Text: ({ children }: any) => React.createElement('Text', null, children),
    Button: ({ children, onPress, disabled }: any) => React.createElement('Button', { onPress, disabled }, children),
    IconButton: ({ icon, onPress }: any) => React.createElement('IconButton', { icon, onPress }),
    TextInput,
    Menu,
    useTheme: () => ({ colors: { surface: '#fff', secondaryContainer: '#eee', outlineVariant: '#ccc', elevation: { level2: '#f2f2f2' }, error: '#d00', onSurface: '#111' } }),
    Divider: 'Divider',
    Dialog,
  };
});

jest.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children }: any) => React.createElement('View', null, children),
    StyleSheet: { create: (v: any) => v, hairlineWidth: 1 },
    TouchableOpacity: ({ children, onPress, testID }: any) => React.createElement('TouchableOpacity', { onPress, testID }, children),
  };
});

jest.mock('react-native-svg', () => ({ SvgUri: 'SvgUri' }));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Medium: 'Medium' } }));
jest.mock('react-native-draggable-flatlist', () => {
  const React = require('react');
  return ({ data, renderItem, ...props }: any) => React.createElement(
    'DraggableFlatList',
    props,
    data.map((item: any) => renderItem({ item, drag: jest.fn(), isActive: false }))
  );
});
jest.mock('@/components/IconPickerModal', () => 'IconPickerModal');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'sv' } }),
}));
const mockStoreState = createMockStoreState({
  notes: [
    { _id: 'pLocked', title: 'Låst Projekt', type: 'project-folder', parentId: null, locked: true, icon: 'https://example.com/icon.svg', tags: [], content: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ],
  activeProjectId: null,
  setActiveProject: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
  verifyNoteLock: (...args: any[]) => mockVerifyNoteLock(...args),
  reorderNotes: jest.fn(),
});

jest.mock('@/stores/useStore', () => ({
  ...require('./helpers/mockUseStore').createSelectorStoreMock(() => mockStoreState),
}));

describe('ProjectSelector unlock focus e2e', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFocusSpy.mockClear();
    mockVerifyNoteLock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('öppnar unlock-dialog med autofokus när låst projekt väljs', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ProjectSelector visible onDismiss={jest.fn()} />
      );
    });

    act(() => {
      const row = tree!.root.findByProps({ testID: 'project-row-pLocked' });
      row.props.onPress();
      jest.advanceTimersByTime(200);
    });

    const input = tree!.root.findByProps({ testID: 'unlock-project-password-input' });
    expect(input.props.autoFocus).toBe(true);
  });

  it('visar diskret inline-fel vid fel lösenord', async () => {
    mockVerifyNoteLock.mockRejectedValue(new Error('Incorrect password'));
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProjectSelector visible onDismiss={jest.fn()} />);
    });

    await act(async () => {
      const row = tree!.root.findByProps({ testID: 'project-row-pLocked' });
      row.props.onPress();
      jest.advanceTimersByTime(200);
    });

    await act(async () => {
      const input = tree!.root.findByProps({ testID: 'unlock-project-password-input' });
      input.props.onChangeText('fel');
    });

    await act(async () => {
      const unlockButton = (tree!.root as any).findAll((node: any) => node.type === 'Button').find((node: any) => node.props.children === 'note.unlock');
      unlockButton?.props.onPress();
    });

    const texts = (tree!.root as any).findAll((node: any) => node.type === 'Text').map((node: any) => node.props.children);
    expect(texts).toContain('projects.unlockWrongPassword');
  });

  it('använder rimlig bottenpadding i projektlistan', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ProjectSelector visible onDismiss={jest.fn()} />);
    });

    const list = (tree!.root as any).findAll((node: any) => node.type === 'DraggableFlatList')[0];
    expect(list.props.contentContainerStyle).toEqual({ paddingBottom: 48 });
  });

  it('behåller svg-ikon för låst projekt i projektlistan', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ProjectSelector visible onDismiss={jest.fn()} />);
    });
    const svgIcons = (tree!.root as any).findAll((node: any) => node.type === 'SvgUri');
    expect(svgIcons.length).toBeGreaterThan(0);
  });
});
