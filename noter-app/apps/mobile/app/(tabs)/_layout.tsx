import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Tabs } from 'expo-router';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import Colors from '@/constants/Colors';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useThemeContext } from '@/context/ThemeContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const { actualTheme } = useThemeContext();
  const colorScheme = actualTheme;
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
        // Hide the bottom tab bar while the keyboard is up so the chat composer can
        // sit directly above the keyboard (no tab bar wedged in between, no clipping).
        tabBarHideOnKeyboard: true,
        // Freeze inactive tabs so a store/socket update (e.g. a note created on
        // another screen) doesn't re-render the off-screen tabs — switching tabs
        // then only pays for the screen you're actually moving to.
        freezeOnBlur: true,
      }}
      // Subtle haptic on every tab switch. Gated on reduceMotion as a proxy
      // for the user's preference for subdued feedback — they're separate
      // OS settings on iOS but conceptually paired here.
      screenListeners={{
        tabPress: () => {
          if (!reduceMotion) {
            try { Haptics.selectionAsync(); } catch { /* haptics is best-effort */ }
          }
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.notes'),
          tabBarIcon: ({ color }) => <TabBarIcon name="sticky-note" color={color} />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Link href="/(tabs)/search" asChild>
                <Pressable>
                  {({ pressed }) => (
                    <FontAwesome
                      name="search"
                      size={20}
                      color={Colors[colorScheme ?? 'light'].text}
                      style={{ marginRight: 20, opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              </Link>
              <Link href="/(tabs)/settings" asChild>
                <Pressable>
                  {({ pressed }) => (
                    <FontAwesome
                      name="cog"
                      size={20}
                      color={Colors[colorScheme ?? 'light'].text}
                      style={{ marginRight: 15, opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              </Link>
            </View>
          ),
          // Remove headerLeft to avoid confusion or back button conflicts
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t('tabs.tasks'),
          tabBarIcon: ({ color }) => <TabBarIcon name="check-square" color={color} />,
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          href: null,
          title: 'Lists',
          tabBarIcon: ({ color }) => <TabBarIcon name="list" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          href: null, // Hide from tab bar
          title: t('tabs.search'),
          tabBarIcon: ({ color }) => <TabBarIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t('tabs.ai'),
          tabBarIcon: ({ color }) => <TabBarIcon name="magic" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null, // Hide from tab bar
          title: t('tabs.settings'),
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
        }}
      />
    </Tabs>
  );
}
