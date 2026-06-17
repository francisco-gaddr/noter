import React from 'react';
import { View, StyleSheet } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { useTheme } from 'react-native-paper';

export type SyncKind = 'nextcloud' | 'webdav' | 'md' | 'server' | null | undefined;

/**
 * Discreet sync indicator pinned to the corner of a folder/note SVG icon: a blue cloud for
 * Nextcloud/server-sync, a purple sync-arrows for MD-external sharing. Renders nothing when the
 * item isn't externally synced. Wrap it next to the icon inside a relatively-positioned container.
 */
export function SyncBadge({ kind, size = 9 }: { kind: SyncKind; size?: number }) {
  const theme = useTheme();
  if (!kind) return null;
  const isMd = kind === 'md';
  const color = isMd ? '#8e24aa' : '#1e88e5';
  const icon = isMd ? 'sync-alt' : 'cloud';
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors.surface }]}>
      <FontAwesome5 name={icon as any} size={size} color={color} solid />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    borderRadius: 8,
    padding: 1,
  },
});
