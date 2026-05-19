import { useCallback, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useReduceMotion } from './useReduceMotion';

/**
 * Standardised long-press menu pattern.
 *
 * The hook owns:
 *   - `open` boolean — drives a host-rendered ActionSheet / Menu / popover
 *   - `selectedItem` — what the user long-pressed; passed back to the
 *     handler when an action is chosen
 *   - `onLongPress(item)` — call from a row's onLongPress prop. Plays a
 *     medium haptic (reduce-motion-gated) and opens the menu.
 *   - `close()` — dismiss without action
 *   - `choose(actionId)` — close + invoke the action's handler
 *
 * The host renders the actual menu UI (Paper Menu, RN ActionSheet, etc.);
 * this hook keeps the state machine consistent across screens.
 */

export interface LongPressAction<TItem> {
  id: string;
  label: string;
  destructive?: boolean;
  /** Called when the user picks this action; receives the long-pressed item. */
  handler: (item: TItem) => void | Promise<void>;
  /** Whether to show this action for the given item — default always-true. */
  visible?: (item: TItem) => boolean;
}

export interface UseLongPressMenuConfig<TItem> {
  actions: ReadonlyArray<LongPressAction<TItem>>;
  /** Disable haptic feedback regardless of reduce-motion. */
  haptic?: boolean;
}

export interface UseLongPressMenuResult<TItem> {
  /** True when the menu should be visible. */
  open: boolean;
  /** The item the user long-pressed (null when closed). */
  selectedItem: TItem | null;
  /** Filter `config.actions` to those visible for the current item. */
  visibleActions: ReadonlyArray<LongPressAction<TItem>>;
  /** Attach to the row's onLongPress prop. */
  onLongPress: (item: TItem) => void;
  /** Dismiss without picking an action. */
  close: () => void;
  /** Invoke an action by id. Closes the menu. */
  choose: (actionId: string) => Promise<void>;
}

export const useLongPressMenu = <TItem>(
  config: UseLongPressMenuConfig<TItem>,
): UseLongPressMenuResult<TItem> => {
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TItem | null>(null);
  const enableHaptic = config.haptic !== false;

  const onLongPress = useCallback((item: TItem) => {
    if (enableHaptic && !reduceMotion) {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch { /* noop */ }
    }
    setSelectedItem(item);
    setOpen(true);
  }, [enableHaptic, reduceMotion]);

  const close = useCallback(() => {
    setOpen(false);
    setSelectedItem(null);
  }, []);

  const choose = useCallback(async (actionId: string): Promise<void> => {
    const action = config.actions.find((a) => a.id === actionId);
    const item = selectedItem;
    setOpen(false);
    setSelectedItem(null);
    if (!action || !item) return;
    try {
      await action.handler(item);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[long-press-menu] action threw', { actionId, error: (err as Error)?.message });
    }
  }, [config.actions, selectedItem]);

  const visibleActions = selectedItem
    ? config.actions.filter((a) => !a.visible || a.visible(selectedItem))
    : [];

  return { open, selectedItem, visibleActions, onLongPress, close, choose };
};
