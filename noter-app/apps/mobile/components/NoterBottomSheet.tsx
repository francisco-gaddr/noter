import React, { forwardRef, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, type BottomSheetBackdropProps, type BottomSheetProps } from '@gorhom/bottom-sheet';
import { useTheme } from 'react-native-paper';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * Project-standard bottom-sheet wrapper.
 *
 * Why centralise:
 *   - Backdrop styling, snap-points, and corner radius were drifting per-
 *     screen. One wrapper means a single visual language.
 *   - a11y: accessibilityViewIsModal / accessibilityRole='dialog' wired
 *     by default — screen-readers correctly treat the sheet as a modal.
 *   - Reduce-motion respect: animation duration is short or skipped when
 *     the OS preference is enabled.
 */

interface NoterBottomSheetProps extends Partial<Omit<BottomSheetProps, 'children'>> {
  children: ReactNode;
  /** Snap-point heights as percentages of screen (default ['40%', '85%']). */
  snapPoints?: (string | number)[];
  /** Accessibility label for the sheet — sets the modal name for screen readers. */
  accessibilityLabel?: string;
  /** Dim the backdrop by this opacity (0–1). Default 0.5. */
  backdropOpacity?: number;
}

const renderBackdrop = (opacity: number) => (props: BottomSheetBackdropProps) => (
  <BottomSheetBackdrop
    {...props}
    appearsOnIndex={0}
    disappearsOnIndex={-1}
    opacity={opacity}
    pressBehavior="close"
  />
);

const NoterBottomSheetInner: React.ForwardRefRenderFunction<BottomSheet, NoterBottomSheetProps> = (
  { children, snapPoints, accessibilityLabel, backdropOpacity = 0.5, ...rest },
  ref,
) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const sheetSnapPoints = useMemo(() => snapPoints ?? ['40%', '85%'], [snapPoints]);
  const backdropComponent = useMemo(() => renderBackdrop(backdropOpacity), [backdropOpacity]);

  return (
    <BottomSheet
      ref={ref}
      snapPoints={sheetSnapPoints}
      index={-1}
      enablePanDownToClose
      // Skip the spring animation under reduce-motion; the OS pref expects
      // motion to be reduced or eliminated for vestibular safety.
      animationConfigs={reduceMotion ? { duration: 1 } as never : undefined}
      backgroundStyle={[styles.background, { backgroundColor: theme.colors.elevation.level2 }]}
      handleIndicatorStyle={{ backgroundColor: theme.colors.onSurfaceVariant }}
      backdropComponent={backdropComponent}
      {...rest}
    >
      <View
        style={styles.content}
        accessibilityViewIsModal
        accessibilityRole="none"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    </BottomSheet>
  );
};

export const NoterBottomSheet = forwardRef(NoterBottomSheetInner);

const styles = StyleSheet.create({
  background: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  content: {
    flex: 1,
    padding: 16,
  },
});
