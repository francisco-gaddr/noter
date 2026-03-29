import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NoteItem } from '../components/NoteItem';
import { encrypt } from '@repo/shared';
import { Provider as PaperProvider, MD3LightTheme } from 'react-native-paper';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' }
}));

jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');
jest.mock('react-native-svg', () => ({ SvgUri: () => null }));
jest.mock('@expo/vector-icons', () => ({
  createIconSet: () => 'Icon',
  FontAwesome: 'Icon',
  MaterialCommunityIcons: 'Icon',
}));

jest.mock('react-native-paper', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    ...jest.requireActual('react-native-paper'),
    IconButton: () => <View testID="icon-button" />,
  };
});

describe('NoteItem Decryption', () => {
  it('should decrypt title if it is encrypted', () => {
    const encryptedTitle = encrypt('My Secret Note');
    const note: any = {
      _id: 'test-note-1',
      title: encryptedTitle,
      content: encrypt('content'),
      __rawEncryptedTitle: encryptedTitle,
      locked: false,
    };

    render(
      <PaperProvider theme={MD3LightTheme}>
        <NoteItem note={note} onPress={() => {}} />
      </PaperProvider>
    );

    expect(screen.getByText('My Secret Note')).toBeTruthy();
  });

  it('should handle plain text title gracefully', () => {
    const note: any = {
      _id: 'test-note-2',
      title: 'Plain Text Title',
      content: 'content',
      __rawEncryptedTitle: 'Plain Text Title', // assuming unencrypted
      locked: false,
    };

    render(
      <PaperProvider theme={MD3LightTheme}>
        <NoteItem note={note} onPress={() => {}} />
      </PaperProvider>
    );

    expect(screen.getByText('Plain Text Title')).toBeTruthy();
  });
});
