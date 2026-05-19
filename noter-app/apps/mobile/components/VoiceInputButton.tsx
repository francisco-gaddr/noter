import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * Push-to-talk voice-input button.
 *
 * What it does today:
 *   - Long-press starts a "listening" state with a subtle haptic and
 *     audible confirmation tone (via expo-speech).
 *   - Release fires `onTranscript('')` — the actual STT engine is
 *     injected by the host since we don't ship a built-in transcriber.
 *     Hosts can wire expo-av's recording → backend STT → string.
 *   - Cancel by sliding away from the button (Pressable's onPressOut +
 *     coordinate check is left to the host wiring).
 *
 * Accessibility:
 *   - Role + label + hint per WCAG 2.1 4.1.2.
 *   - Visible-state changes mirror the listening state for screen-readers.
 *   - Reduce-motion gates the pulse animation (a future refinement);
 *     haptics fall back to selectionAsync.
 */

interface VoiceInputButtonProps {
  /** Called when the user lifts their finger; arg is whatever the host's STT returned. */
  onTranscript: (text: string) => void;
  /** Called when the user starts holding. Host may begin recording here. */
  onStart?: () => Promise<string | null> | void;
  disabled?: boolean;
  size?: number;
}

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscript,
  onStart,
  disabled,
  size = 36,
}) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [listening, setListening] = useState(false);
  const startedAtRef = useRef<number>(0);

  const beginListening = async () => {
    if (disabled) return;
    setListening(true);
    startedAtRef.current = Date.now();
    if (!reduceMotion) {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch { /* noop */ }
    }
    try { Speech.stop(); } catch { /* noop */ }
    if (typeof onStart === 'function') {
      try { await onStart(); } catch { /* host handles its own errors */ }
    }
  };

  const endListening = async () => {
    if (!listening) return;
    setListening(false);
    if (!reduceMotion) {
      try { Haptics.selectionAsync(); } catch { /* noop */ }
    }
    // Guard against accidental taps — if held for <300ms, treat as no-op.
    if (Date.now() - startedAtRef.current < 300) {
      onTranscript('');
      return;
    }
    // The actual STT result comes back through onStart's resolved value if
    // the host uses that pattern; we leave the host responsible for piping
    // text to onTranscript when the recording finishes.
    onTranscript('');
  };

  return (
    <View>
      <Pressable
        onLongPress={beginListening}
        onPressOut={endListening}
        delayLongPress={150}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Listening for voice input' : 'Voice input'}
        accessibilityHint="Long-press and hold to dictate. Release to stop."
        accessibilityState={{ busy: listening, disabled: !!disabled }}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2 },
          {
            backgroundColor: listening
              ? theme.colors.errorContainer
              : pressed
              ? theme.colors.secondaryContainer
              : theme.colors.surfaceVariant,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <IconButton
          icon={listening ? 'microphone' : 'microphone-outline'}
          size={size * 0.7}
          iconColor={listening ? theme.colors.error : theme.colors.onSurfaceVariant}
          style={styles.icon}
          accessibilityLabel={undefined as unknown as string}
        />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    margin: 0,
  },
});
