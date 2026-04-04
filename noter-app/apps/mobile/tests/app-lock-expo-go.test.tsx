import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createMockStoreState } from './helpers/mockUseStore';

const mockSetSecurityLocked = jest.fn(async () => undefined);
const mockAuthenticate = jest.fn(async () => ({ success: true }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    executionEnvironment: 'storeClient',
    appOwnership: 'expo',
  },
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
  },
}));

jest.mock('@/hooks/useBiometrics', () => ({
  useBiometrics: () => ({
    isSupported: true,
    isEnrolled: true,
    authenticate: mockAuthenticate,
    getBiometryLabel: () => 'Face ID',
  }),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  AuthenticationType: {
    FACIAL_RECOGNITION: 1,
    FINGERPRINT: 2,
  },
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
  Button: 'Button',
  Text: 'Text',
  Surface: 'Surface',
  useTheme: () => ({ colors: { background: '#fff' } }),
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  View: 'View',
  StyleSheet: { create: (value: any) => value },
}));

import { AppLock } from '../components/AppLock';

describe('AppLock i Expo Go', () => {
  beforeEach(() => {
    mockSetSecurityLocked.mockClear();
    mockAuthenticate.mockClear();
  });

  it('släpper igenom appen utan biometrisk blockering', async () => {
    let tree: renderer.ReactTestRenderer;
    const Child = () => React.createElement('View');

    await act(async () => {
      tree = renderer.create(
        <AppLock>
          <Child />
        </AppLock>
      );
      await Promise.resolve();
    });

    expect(tree!.root.findByType(Child)).toBeTruthy();
    expect(mockSetSecurityLocked).toHaveBeenCalledWith(false);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
