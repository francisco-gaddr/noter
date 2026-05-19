import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * Lightweight skeleton loaders for list/card placeholders.
 *
 * Why centralise: every screen rolled its own "grey rectangle while
 * loading" with slightly different colours. The Paper theme gives us
 * a consistent `surfaceVariant`; we just need a wrapper that respects
 * `prefers-reduced-motion` (no shimmer in that mode).
 *
 * Components:
 *   - <SkeletonBox /> — primitive: a fixed-size rounded rectangle
 *   - <SkeletonRow count={n} /> — n vertically stacked rows
 *   - <SkeletonCard /> — card-shaped placeholder with title + body lines
 *
 * All use Animated to drive a 1.4s pulse cycle; under reduce-motion the
 * opacity is held at a single value (no animation).
 */

interface SkeletonBoxProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
  testID?: string;
}

const usePulse = (reduceMotion: boolean): Animated.AnimatedInterpolation<number> => {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      value.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, value]);
  return value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
};

export const SkeletonBox: React.FC<SkeletonBoxProps> = ({ width = '100%', height = 16, radius = 6, style, testID }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = usePulse(reduceMotion);
  return (
    <Animated.View
      testID={testID}
      accessibilityRole="none"
      accessibilityLabel="Loading"
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: theme.colors.surfaceVariant,
          opacity,
        },
        style,
      ]}
    />
  );
};

interface SkeletonRowProps {
  count?: number;
  spacing?: number;
}

export const SkeletonRow: React.FC<SkeletonRowProps> = ({ count = 4, spacing = 12 }) => (
  <View style={{ padding: 16 }}>
    {Array.from({ length: count }, (_, i) => (
      <SkeletonBox key={i} height={20} style={{ marginBottom: i === count - 1 ? 0 : spacing }} />
    ))}
  </View>
);

export const SkeletonCard: React.FC = () => {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.elevation.level1 }]}>
      <SkeletonBox height={18} width="60%" style={{ marginBottom: 12 }} />
      <SkeletonBox height={14} style={{ marginBottom: 8 }} />
      <SkeletonBox height={14} width="90%" style={{ marginBottom: 8 }} />
      <SkeletonBox height={14} width="70%" />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
  },
});
