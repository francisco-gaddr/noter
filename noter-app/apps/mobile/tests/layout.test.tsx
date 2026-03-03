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

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  useColorScheme: () => 'light',
}));
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
