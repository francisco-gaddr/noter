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
