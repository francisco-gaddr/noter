import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View, Text, Platform } from 'react-native';
import Svg, {
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
  Rect,
  Circle,
  G,
  Path,
} from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
// Note: motion is driven on plain Animated.View wrappers (native-driver-safe) rather than on
// SVG props — react-native-svg props can't be driven by the native animation module.

/**
 * Full-screen branded launch splash that covers the ENTIRE screen with detailed,
 * layered art + motion — a deep radial backdrop, concentric "signal" rings, a soft glow,
 * and the Noter note+check emblem. Rendered by the root layout while the app boots and
 * fades itself out once the UI is ready (calls onHidden so the parent can unmount it).
 *
 * Self-contained and dependency-light (react-native-svg + RN Animated only) so it works
 * identically in Expo Go, dev builds, and production — no native rebuild required.
 */
const BRAND = {
  bgEdge: '#050507',
  bgCenter: '#16161F',
  ring: '#2A2A38',
  glow: '#3A3A52',
  paper: '#F7F7FA',
  paperFold: '#D8D8E0',
  ink: '#0C0C10',
  line: '#D2D2DC',
};

export function AnimatedSplash({ visible, onHidden }: { visible: boolean; onHidden?: () => void }) {
  const { width, height } = useWindowDimensions();
  // Overlay opacity (1 = shown). Drops to 0 on fade-out.
  const overlay = useRef(new Animated.Value(1)).current;
  // Emblem intro: scale + fade.
  const emblemScale = useRef(new Animated.Value(0.82)).current;
  const emblemOpacity = useRef(new Animated.Value(0)).current;
  // Wordmark intro.
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordShift = useRef(new Animated.Value(10)).current;
  // Looping pulse for the rings + glow.
  const pulse = useRef(new Animated.Value(0)).current;

  // Reveal our JS splash by dismissing the native one as soon as we mount.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
    Animated.parallel([
      Animated.spring(emblemScale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      Animated.timing(emblemOpacity, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(220),
        Animated.parallel([
          Animated.timing(wordOpacity, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(wordShift, { toValue: 0, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [emblemScale, emblemOpacity, wordOpacity, wordShift, pulse]);

  // Fade out when the app is ready.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      Animated.timing(overlay, {
        toValue: 0,
        duration: 480,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) onHidden?.(); });
    }, 180); // brief beat so the intro is felt even on instant boots
    return () => clearTimeout(t);
  }, [visible, overlay, onHidden]);

  // Cover all aspect ratios: a square SVG canvas scaled to the larger screen dimension,
  // centered, so the radial art always bleeds past every edge.
  const canvas = Math.max(width, height) * 1.2;
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.9] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] });

  // Emblem geometry (drawn in a 220-box, centered).
  const E = 220;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { opacity: overlay, backgroundColor: BRAND.bgEdge }]}
    >
      {/* Layer 1a — full-bleed radial backdrop (static) */}
      <View style={StyleSheet.absoluteFill}>
        <Svg width={width} height={height} viewBox={`0 0 ${canvas} ${canvas}`} style={styles.bgSvg}>
          <Defs>
            <RadialGradient id="bg" cx="50%" cy="46%" r="62%">
              <Stop offset="0%" stopColor={BRAND.bgCenter} stopOpacity={1} />
              <Stop offset="60%" stopColor="#0B0B11" stopOpacity={1} />
              <Stop offset="100%" stopColor={BRAND.bgEdge} stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={canvas} height={canvas} fill="url(#bg)" />
        </Svg>
      </View>

      {/* Layer 1b — concentric "signal" rings that gently breathe (native-driven View) */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bgSvg, { width, height, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      >
        <Svg width={width} height={height} viewBox={`0 0 ${canvas} ${canvas}`}>
          {[0.16, 0.26, 0.36, 0.46].map((r, i) => (
            <Circle
              key={i}
              cx={canvas / 2}
              cy={canvas / 2}
              r={canvas * r}
              stroke={BRAND.ring}
              strokeWidth={1.5}
              fill="none"
            />
          ))}
        </Svg>
      </Animated.View>

      {/* Layer 2 — glow + emblem, centered */}
      <View style={styles.center} pointerEvents="none">
        <Animated.View style={{ position: 'absolute', opacity: glowOpacity }}>
          <Svg width={canvas * 0.6} height={canvas * 0.6} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="emblemGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={BRAND.glow} stopOpacity={0.55} />
                <Stop offset="100%" stopColor={BRAND.glow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={50} cy={50} r={50} fill="url(#emblemGlow)" />
          </Svg>
        </Animated.View>

        <Animated.View style={{ opacity: emblemOpacity, transform: [{ scale: emblemScale }] }}>
          <Svg width={E} height={E} viewBox="0 0 220 220">
            <Defs>
              <LinearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="#FFFFFF" />
                <Stop offset="100%" stopColor={BRAND.paper} />
              </LinearGradient>
            </Defs>
            {/* Document body with folded corner */}
            <G>
              <Path
                d="M58 36 H132 L166 70 V178 A6 6 0 0 1 160 184 H58 A6 6 0 0 1 52 178 V42 A6 6 0 0 1 58 36 Z"
                fill="url(#paper)"
              />
              <Path d="M132 36 V64 A6 6 0 0 0 138 70 H166 Z" fill={BRAND.paperFold} />
              {/* Text lines */}
              <Rect x={72} y={92} width={62} height={9} rx={4.5} fill={BRAND.line} />
              <Rect x={72} y={114} width={48} height={9} rx={4.5} fill={BRAND.line} />
              <Rect x={72} y={136} width={40} height={9} rx={4.5} fill={BRAND.line} />
            </G>
            {/* Check badge */}
            <Circle cx={140} cy={138} r={30} fill={BRAND.ink} />
            <Path
              d="M127 138 l9 9 l18 -19"
              stroke="#FFFFFF"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Animated.View>

        {/* Wordmark + tagline */}
        <Animated.View style={{ opacity: wordOpacity, transform: [{ translateY: wordShift }], alignItems: 'center', marginTop: 28 }}>
          <Text style={styles.word}>Noter</Text>
          <Text style={styles.tag}>Säker · Offline · Synkad</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgSvg: { position: 'absolute', top: 0, left: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  word: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 6,
    textShadowColor: 'rgba(120,120,160,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  tag: {
    color: '#9A9AB2',
    fontSize: 13,
    letterSpacing: 2,
    marginTop: 8,
  },
});

export default AnimatedSplash;
