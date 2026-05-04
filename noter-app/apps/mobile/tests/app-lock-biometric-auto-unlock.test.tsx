import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createMockStoreState } from './helpers/mockUseStore';

const mockSetSecurityLocked = jest.fn(async () => undefined);
const mockAuthenticate = jest.fn(async () => ({ success: true }));
const mockHasHardwareAsync = jest.fn(async () => true);
const mockIsEnrolledAsync = jest.fn(async () => true);

jest.useFakeTimers();

jest.mock('@/utils/runtime', () => ({
  isExpoGo: () => false,
}));

jest.mock('@/hooks/useBiometrics', () => ({
  useBiometrics: () => ({
    authenticate: mockAuthenticate,
    getBiometryLabel: () => 'Fingeravtryck',
  }),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => mockHasHardwareAsync(),
  isEnrolledAsync: () => mockIsEnrolledAsync(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockStoreState = createMockStoreState({
  setSecurityLocked: mockSetSecurityLocked,
});

jest.mock('@/stores/useStore', () => ({
  ...require('./helpers/mockUseStore').createSelectorStoreMock(() => mockStoreState),
}));

jest.mock('react-native-paper', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Button: 'Button',
  Text: 'Text',
  Surface: 'Surface',
  useTheme: () => ({ colors: { background: '#fff' } }),
}));

let appStateListener: ((nextState: string) => void) | null = null;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: any, listener: any) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  View: 'View',
  StyleSheet: { create: (value: any) => value },
}));

import { AppLock } from '../components/AppLock';

describe('AppLock biometrisk direktupplåsning', () => {
  beforeEach(() => {
    mockSetSecurityLocked.mockClear();
    mockAuthenticate.mockClear();
    mockHasHardwareAsync.mockClear();
    mockIsEnrolledAsync.mockClear();
    appStateListener = null;
  });

  it('försöker biometrisk upplåsning direkt utan knapptryck', async () => {
    await act(async () => {
      renderer.create(
        <AppLock>
          <></>
        </AppLock>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockAuthenticate).toHaveBeenCalledWith('passwordModal.unlock');
    expect(mockSetSecurityLocked).toHaveBeenCalledWith(false);
  });

  it('triggar inte biometrisk prompt två gånger vid background→active under auth', async () => {
    mockAuthenticate.mockImplementationOnce(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      return { success: true };
    });

    await act(async () => {
      renderer.create(
        <AppLock>
          <></>
        </AppLock>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });
});
