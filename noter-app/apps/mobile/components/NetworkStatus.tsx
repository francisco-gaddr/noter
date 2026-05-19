import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Pressable } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function NetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [dismissed, setDismissed] = useState(false);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [heightAnim] = useState(new Animated.Value(0));

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
    Animated.timing(heightAnim, {
      toValue: isConnected === false && !dismissed ? 32 + insets.top : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [isConnected, dismissed, insets.top]);

  useEffect(() => {
    if (isConnected === true) {
      setDismissed(false);
      AsyncStorage.removeItem('hideOfflineBanner');
    }
  }, [isConnected]);

  if (isConnected === true || dismissed) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: heightAnim,
          backgroundColor: withAlpha(theme.colors.error, 0.5), // More transparent
        },
      ]}
    >
      <View style={[styles.content, { paddingTop: insets.top }]}>
        <Text variant="labelMedium" style={{ color: theme.colors.onError }}>
          Offline
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              // Trigger a fresh NetInfo probe. NetInfo's internal listeners
              // will refire if the device actually has connectivity again,
              // and the offline queue (round 7) will flush automatically.
              NetInfo.refresh().catch(() => undefined);
            }}
            accessibilityRole="button"
            accessibilityLabel="Försök igen"
            accessibilityHint="Pröva att ansluta till servern igen"
            style={styles.retry}
            hitSlop={8}
          >
            <Text variant="labelSmall" style={{ color: theme.colors.onError, textDecorationLine: 'underline' }}>
              Försök igen
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              AsyncStorage.setItem('hideOfflineBanner', 'true');
              setDismissed(true);
            }}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Dölj offline-indikator"
          >
            <IconButton icon="close" size={14} iconColor={theme.colors.onError} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center', // Center horizontally
    width: '60%',
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
  },
  close: {
    marginLeft: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  retry: {
    paddingHorizontal: 6,
    paddingVertical: 4,
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
