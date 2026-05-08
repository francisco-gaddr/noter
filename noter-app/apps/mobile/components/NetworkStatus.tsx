import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Pressable } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/services/i18n';
import { useStore } from '@/stores/useStore';

export function NetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedConflict, setDismissedConflict] = useState(false);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [heightAnim] = useState(new Animated.Value(0));
  const syncConflicts = useStore((state) => state.syncConflicts);
  const clearSyncConflicts = useStore((state) => state.clearSyncConflicts);
  const backgroundRefresh = useStore((state) => state.backgroundRefresh);
  const conflictCount = syncConflicts.length;
  const latestConflictTitle = syncConflicts[0]?.title;

  useEffect(() => {
    AsyncStorage.getItem('hideOfflineBanner').then(value => {
      setDismissed(value === 'true');
    });
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (conflictCount > 0) {
      setDismissedConflict(false);
    }
  }, [conflictCount]);

  const visibleBannerCount = Number(isConnected === false && !dismissed) + Number(conflictCount > 0 && !dismissedConflict);

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: visibleBannerCount > 0 ? (visibleBannerCount * 32) + insets.top + 4 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [visibleBannerCount, insets.top]);

  useEffect(() => {
    if (isConnected === true) {
      setDismissed(false);
      AsyncStorage.removeItem('hideOfflineBanner');
    }
  }, [isConnected]);

  if (visibleBannerCount === 0) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: heightAnim,
        },
      ]}
    >
      <View style={{ paddingTop: insets.top }}>
        {isConnected === false && !dismissed && (
          <View style={[styles.content, { backgroundColor: withAlpha(theme.colors.error, 0.5) }]}>
            <Text variant="labelMedium" style={{ color: theme.colors.onError }}>
              {i18n.t('sync.offlineBanner')}
            </Text>
            <Pressable
              onPress={() => {
                AsyncStorage.setItem('hideOfflineBanner', 'true');
                setDismissed(true);
              }}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={i18n.t('sync.hideOfflineBanner')}
            >
              <IconButton icon="close" size={14} iconColor={theme.colors.onError} />
            </Pressable>
          </View>
        )}
        {conflictCount > 0 && !dismissedConflict && (
          <View style={[styles.content, styles.secondaryContent, { backgroundColor: withAlpha(theme.colors.tertiary, 0.22) }]}>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurface, flex: 1 }}>
              {latestConflictTitle
                ? `${i18n.t('sync.conflictBanner', { count: conflictCount })}: ${latestConflictTitle}`
                : i18n.t('sync.conflictBanner', { count: conflictCount })}
            </Text>
            <Pressable
              onPress={() => {
                void backgroundRefresh();
              }}
              accessibilityRole="button"
              accessibilityLabel={i18n.t('settings.syncNow')}
            >
              <IconButton icon="sync" size={16} iconColor={theme.colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => {
                clearSyncConflicts();
                setDismissedConflict(true);
              }}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={i18n.t('sync.hideConflictBanner')}
            >
              <IconButton icon="close" size={14} iconColor={theme.colors.onSurface} />
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center', // Center horizontally
    width: '88%',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    zIndex: 9999,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 2,
    minHeight: 32,
  },
  secondaryContent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  close: {
    marginLeft: 6,
  },
});

function withAlpha(color: string, alpha: number) {
  if (typeof color !== 'string') return color as any;
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) return color;
  if (!color.startsWith('#')) return color;

  const hex = color.slice(1);
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}
