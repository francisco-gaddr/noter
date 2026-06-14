// Mock expo-modules-core to avoid winter runtime errors
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return {
    ...actual,
    requireNativeModule: jest.fn(),
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Mock react-native-gesture-handler
require('react-native-gesture-handler/jestSetup');

// Fix ReferenceError: __ExpoImportMetaRegistry
global.__ExpoImportMetaRegistry = {};


// Fix ReferenceError: structuredClone
global.structuredClone = (val) => JSON.parse(JSON.stringify(val));

// Mock other native modules if needed
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  removeNotificationSubscription: jest.fn(),
}));

// expo-secure-store reads its keychain-accessibility enum from a native
// module that doesn't exist under jest; supplying the JS shape unblocks
// every test that transitively imports it (api → useStore → many tabs).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
  ALWAYS: 'ALWAYS',
  ALWAYS_THIS_DEVICE_ONLY: 'ALWAYS_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
  canUseBiometricAuthentication: jest.fn(() => false),
}));

// @react-native-community/netinfo's native interface isn't available under
// jest; supply a small JS surface that the stores and hooks call.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => undefined),
  fetch: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
    details: { isConnectionExpensive: false },
  })),
  useNetInfo: jest.fn(() => ({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  })),
  refresh: jest.fn(async () => undefined),
}));

// AccessibilityInfo.isReduceMotionEnabled is read by useReduceMotion; the
// RN testing shim doesn't include it, so we patch the namespace.
jest.mock('react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo', () => ({
  isReduceMotionEnabled: jest.fn(async () => false),
  isScreenReaderEnabled: jest.fn(async () => false),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  announceForAccessibility: jest.fn(),
  setAccessibilityFocus: jest.fn(),
}));

// expo-haptics throws under jest because its native side isn't wired up;
// the JS surface only needs to be callable for our hooks (useRefreshControl,
// useLongPressMenu).
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));

// expo/fetch is a native (RN-runtime) module providing a streaming fetch. Stub it
// so modules that import it (services/ai/apiProviders streaming) load under jest;
// streaming itself isn't exercised in unit tests.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

// llama.rn binds llama.cpp natively; the import throws under jest. A small JS shim
// keeps services/ai/llama importable (callers gate real use behind isLlamaLinked()).
// Suites that need ModelManager behaviour mock it directly; this is just the floor.
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(async () => ({
    completion: jest.fn(async () => ({ text: '' })),
    stopCompletion: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  })),
  releaseAllLlama: jest.fn(async () => undefined),
}), { virtual: true });

// react-native-safe-area-context's NativeSafeAreaContext TurboModule spec throws at
// import time under jest ("Cannot read properties of undefined (reading 'get')"),
// which fails every suite that transitively imports a screen. A self-contained mock
// (the pattern the library docs recommend for jest) avoids loading the native module.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const InsetsContext = React.createContext(inset);
  const FrameContext = React.createContext(frame);
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaConsumer: InsetsContext.Consumer,
    SafeAreaInsetsContext: InsetsContext,
    SafeAreaFrameContext: FrameContext,
    SafeAreaView: ({ children, ...props }) => React.createElement('View', props, children),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets: inset, frame },
    withSafeAreaInsets: (Comp) => Comp,
  };
});
