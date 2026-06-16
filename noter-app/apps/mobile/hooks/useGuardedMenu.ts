import { useCallback, useRef, useState } from 'react';

/**
 * Reliable react-native-paper <Menu> open/close state.
 *
 * The naive pattern — `anchor onPress={() => setVisible(true)}` + `onDismiss={() => setVisible(false)}`
 * — intermittently "stops working after a tap or two": when the menu is open and you tap the anchor,
 * the Portal backdrop catches the tap (dismiss → visible=false) AND the anchor's onPress fires
 * (open → visible=true) in the same frame. The race leaves the menu stuck and the trigger appears
 * dead even though it's still pressable.
 *
 * This hook records the dismiss timestamp and ignores any `open()` that arrives within a short guard
 * window after a dismiss, so the propagated/duplicate tap can't immediately reopen (or wedge) it.
 * The anchor must call `open()` (never a toggle).
 *
 * Usage:
 *   const m = useGuardedMenu();
 *   <Menu visible={m.visible} onDismiss={m.dismiss} anchor={<Button onPress={m.open} .../>}>
 *     <Menu.Item onPress={() => { doThing(); m.dismiss(); }} ... />
 *   </Menu>
 */
export function useGuardedMenu(guardMs = 250): {
  visible: boolean;
  open: () => void;
  dismiss: () => void;
} {
  const [visible, setVisible] = useState(false);
  const guardRef = useRef(0);
  const open = useCallback(() => {
    if (Date.now() - guardRef.current > guardMs) setVisible(true);
  }, [guardMs]);
  const dismiss = useCallback(() => {
    guardRef.current = Date.now();
    setVisible(false);
  }, []);
  return { visible, open, dismiss };
}
