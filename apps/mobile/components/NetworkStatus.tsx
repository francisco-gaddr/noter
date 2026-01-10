import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function NetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [heightAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: isConnected === false ? 40 + insets.top : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [isConnected, insets.top]);

  // Don't render anything if connected (or initial null state), but keep in tree for animation
  if (isConnected === true) return null;

  return (
    <Animated.View
      pointerEvents="none"
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
          No Internet Connection
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center', // Center horizontally
    width: '50%', // Much smaller width
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    zIndex: 9999,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 4,
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
