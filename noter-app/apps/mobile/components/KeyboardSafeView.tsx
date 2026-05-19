import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type ViewStyle } from 'react-native';

interface KeyboardSafeViewProps {
  children: ReactNode;
  /**
   * Extra offset beyond the header/safe-area. Use when a form sits below a
   * sticky element (e.g., chip bar) that needs to remain visible above the
   * keyboard.
   */
  offset?: number;
  /** Wrap children in a ScrollView (recommended for long forms). */
  scrollable?: boolean;
  /** keyboardShouldPersistTaps — default 'handled' so taps on buttons inside
   * inputs still register. Use 'never' for forms where every tap should
   * dismiss the keyboard first.
   */
  keyboardShouldPersistTaps?: 'never' | 'handled' | 'always';
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}

/**
 * Cross-platform form-friendly wrapper.
 *
 * iOS: `behavior="padding"` shifts content above the keyboard.
 * Android: `behavior="height"` (sometimes undefined) is more reliable than
 *   padding which fights the WindowSoftInputMode in the manifest.
 *
 * Default offset of 0 — caller passes header height (or use
 * useHeaderHeight() from React Navigation) when the screen has one.
 */
export const KeyboardSafeView: React.FC<KeyboardSafeViewProps> = ({
  children,
  offset = 0,
  scrollable = false,
  keyboardShouldPersistTaps = 'handled',
  style,
  contentContainerStyle,
}) => {
  const behavior = Platform.OS === 'ios' ? 'padding' : undefined;
  const inner = scrollable ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      behavior={behavior}
      keyboardVerticalOffset={offset}
    >
      {inner}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
