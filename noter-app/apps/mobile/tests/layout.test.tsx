import React from 'react';
import renderer, { act } from 'react-test-renderer';
import TabLayout from '../app/(tabs)/_layout';

// Mock dependencies
jest.mock('@expo/vector-icons/FontAwesome', () => 'FontAwesome');
jest.mock('expo-router', () => ({
  Link: ({ children }: any) => children,
  Tabs: ({ children }: any) => <>{children}</>,
}));
// Mock static property on Tabs
(require('expo-router').Tabs as any).Screen = ({ options }: any) => {
    // If headerRight is a function, call it to verify it renders without error
    if (typeof options?.headerRight === 'function') {
        options.headerRight();
    }
    return null;
};

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  // Narrow stubs for what the test asserts on + everything REAL via Proxy —
  // a bare stub object breaks Platform/AccessibilityInfo/etc. as the app grows,
  // and eager Object.assign would fire RN's deprecated-module getters.
  const overrides = {
  Pressable: 'Pressable',
  View: 'View',
  useColorScheme: () => 'light',
};
  return new Proxy(overrides, { get: (t: any, p: any) => (p in t ? t[p] : actual[p]) });
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/constants/Colors', () => ({
  light: { tint: '#000', text: '#000' },
  dark: { tint: '#fff', text: '#fff' },
}));
jest.mock('@/components/useClientOnlyValue', () => ({
  useClientOnlyValue: (server: any, client: any) => client,
}));
jest.mock('@/context/ThemeContext', () => ({
  useThemeContext: () => ({ actualTheme: 'light' }),
}));

describe('TabLayout', () => {
  it('renders correctly and defines header icons for Notes tab', () => {
    let tree: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null = null;
    act(() => {
      tree = renderer.create(<TabLayout />).toJSON();
    });
    expect(tree).toMatchSnapshot();
  });
});
