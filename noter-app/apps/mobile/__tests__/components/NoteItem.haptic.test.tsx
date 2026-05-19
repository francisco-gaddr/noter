import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';

// expo-font would try to call native isLoaded() when @expo/vector-icons renders;
// we stub it to always-loaded so icons render as placeholder Text in tests.
jest.mock('expo-font', () => ({
  isLoaded: () => true,
  loadAsync: jest.fn(),
  useFonts: () => [true, null],
}));
jest.mock('@expo/vector-icons/FontAwesome5', () => 'FontAwesome5');

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'Medium', Light: 'Light' },
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Warning: 'Warning', Success: 'Success' },
}));

import * as Haptics from 'expo-haptics';
import { NoteItem } from '../../components/NoteItem';

const wrapWithPaper = (ui: React.ReactNode) => <PaperProvider>{ui}</PaperProvider>;

const makeNote = (overrides: Partial<any> = {}) => ({
  _id: 'n1',
  title: 'A note',
  content: '',
  tags: [],
  userId: 'u',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('NoteItem haptics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires selectionAsync on press', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      wrapWithPaper(<NoteItem note={makeNote() as any} onPress={onPress} />)
    );
    fireEvent.press(getByText('A note'));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('fires impactAsync(Medium) on long-press (drag-engage)', () => {
    const onLongPress = jest.fn();
    const onPress = jest.fn();
    const { getByText } = render(
      wrapWithPaper(<NoteItem note={makeNote() as any} onPress={onPress} onLongPress={onLongPress} />)
    );
    // Trigger long-press
    fireEvent(getByText('A note'), 'onLongPress');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('Medium');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
