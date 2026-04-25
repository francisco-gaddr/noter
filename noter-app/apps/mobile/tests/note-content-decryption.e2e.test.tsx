import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import NoteEditorScreen from '../app/note/[id]';
import { useStore } from '../stores/useStore';
import { clearEncryptionKey, encrypt, setEncryptionKey } from '@repo/shared';
import { ThemeProvider } from '@react-navigation/native';
import { MD3LightTheme, Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Mock expo-router
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'test-note-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  Stack: { Screen: () => null },
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => {
  const mockSafeAreaContext = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return {
    ...mockSafeAreaContext,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' }
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn(),
  })
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(null),
}));
jest.mock('expo-crypto', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn(),
}));
jest.mock('react-native-svg', () => ({ SvgUri: () => null }));
jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    FontAwesome5: () => <View testID="fa5-icon" />,
  };
});
jest.mock('@expo/vector-icons/FontAwesome5', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return () => <View testID="fa5-icon" />;
});
jest.mock('react-native-paper', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  const Actual = jest.requireActual('react-native-paper');
  return {
    ...Actual,
    IconButton: () => <View testID="icon-button" />,
    Appbar: {
      Header: ({ children }: any) => <View>{children}</View>,
      BackAction: () => <View testID="back-action" />,
      Content: ({ title }: any) => <Text>{title}</Text>,
      Action: () => <View testID="appbar-action" />,
    }
  };
});

// Mock rich editor
jest.mock('react-native-pell-rich-editor', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    RichEditor: ReactMock.forwardRef((props: any, ref: any) => {
      console.log('initialContentHTML:', props.initialContentHTML);
      return <View testID="rich-editor"><Text>{props.initialContentHTML || 'EMPTY'}</Text></View>;
    }),
    RichToolbar: () => null,
    actions: {},
  };
});

describe('NoteEditorScreen Decryption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEncryptionKey('a'.repeat(64));
    useStore.setState({
      notes: [],
      unlockedProtectedNoteIds: [],
      updateNote: jest.fn().mockResolvedValue(undefined),
      createNote: jest.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('should decrypt raw encrypted content and title correctly', async () => {
    // Simulate a note that came directly from DB/socket without materialization
    const encryptedContent = encrypt('<p>Secret Content</p>');
    const encryptedTitle = encrypt('Secret Title');

    useStore.setState({
      notes: [
        {
          _id: 'test-note-1',
          title: encryptedTitle,
          content: encryptedContent,
          __rawEncryptedTitle: encryptedTitle,
          __rawEncryptedContent: encryptedContent,
          tags: [],
          locked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: 'test-user',
          type: 'note',
          order: 0,
        } as any,
      ],
    });

    try {
      render(
        <SafeAreaProvider>
          <PaperProvider theme={MD3LightTheme as any}>
            <NoteEditorScreen />
          </PaperProvider>
        </SafeAreaProvider>
      );
    } catch (e: any) {
      console.error(e.errors ? e.errors : e);
    }

    await waitFor(() => {
      // The RichEditor should receive the decrypted HTML
      expect(screen.getByText(/<p>Secret Content<\/p>/i)).toBeTruthy();
    });
  });

  it('should never render ciphertext when decryption fails after unlock', async () => {
    const brokenCiphertext = 'U2FsdGVkX1broken-payload';

    useStore.setState({
      notes: [
        {
          _id: 'test-note-1',
          title: brokenCiphertext,
          content: brokenCiphertext,
          __rawEncryptedTitle: brokenCiphertext,
          __rawEncryptedContent: brokenCiphertext,
          tags: [],
          locked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: 'test-user',
          type: 'note',
          order: 0,
        } as any,
      ],
    });

    render(
      <SafeAreaProvider>
        <PaperProvider theme={MD3LightTheme as any}>
          <NoteEditorScreen />
        </PaperProvider>
      </SafeAreaProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('EMPTY')).toBeTruthy();
      expect(screen.queryByText(brokenCiphertext)).toBeNull();
    });
  });
});
