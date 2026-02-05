import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Animated, Platform, TouchableOpacity } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

export function NetworkStatus() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [isVisible, setIsVisible] = useState(false);
  const heightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = state.isConnected;
      setIsConnected(connected);
      if (connected === false) {
        setIsVisible(true);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: isConnected === false && isVisible ? 40 + insets.top : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [isConnected, isVisible, insets.top]);

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (isConnected === true && !isVisible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: heightAnim,
          backgroundColor: withAlpha(theme.colors.error, 0.9),
        },
      ]}
    >
      <TouchableOpacity 
        activeOpacity={0.8} 
        onPress={handleDismiss}
        style={[styles.content, { paddingTop: insets.top }]}
      >
        <Text variant="labelMedium" style={{ color: theme.colors.onError }}>
          No Internet Connection - Tap to dismiss
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: '100%',
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
