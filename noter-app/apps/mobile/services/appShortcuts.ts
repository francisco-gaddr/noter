/**
 * App-shortcut registry + activation handler.
 *
 * iOS 3D-touch and Android "pinned shortcuts" let the user long-press
 * the app icon and pick an action. We define them here as a typed list
 * so the registration code path AND the activation-handler share the
 * same vocabulary.
 *
 * Why a separate module: the actual registration depends on
 * `expo-quick-actions` (or react-native-app-shortcuts), neither of
 * which is currently installed. Shipping the schema now means adopting
 * the dep later is a one-import change.
 *
 * Each shortcut declares:
 *   - id: stable identifier (used for both registration and event-match)
 *   - title: shown in the menu
 *   - subtitle: secondary line (iOS)
 *   - icon: platform icon name; the renderer maps these to actual assets
 *   - route: internal Expo Router route to navigate to
 */

export interface AppShortcut {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  route: string;
}

const SHORTCUTS: AppShortcut[] = [
  { id: 'newNote', title: 'New Note', subtitle: 'Start writing immediately', icon: 'compose', route: '/note/new' },
  { id: 'search', title: 'Search', subtitle: 'Find a note by content', icon: 'search', route: '/(tabs)/search' },
  { id: 'lastNote', title: 'Continue Last Note', subtitle: 'Resume where you left off', icon: 'bookmark', route: '/' },
  { id: 'newTask', title: 'New Task', subtitle: 'Capture a quick to-do', icon: 'add-to-list', route: '/task/new' },
];

const ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;

export const isValidShortcutId = (id: string): boolean =>
  typeof id === 'string' && ID_PATTERN.test(id);

export const getAppShortcuts = (): readonly AppShortcut[] => SHORTCUTS;

export const findShortcut = (id: string): AppShortcut | undefined =>
  SHORTCUTS.find((s) => s.id === id);

/**
 * Validate that a shortcut id received from the OS matches one we
 * registered. Defensive against future OS APIs that pass arbitrary
 * strings through.
 */
export const resolveShortcutActivation = (
  rawId: unknown,
): { ok: true; shortcut: AppShortcut } | { ok: false; reason: string } => {
  if (typeof rawId !== 'string') return { ok: false, reason: 'invalid-type' };
  if (!isValidShortcutId(rawId)) return { ok: false, reason: 'invalid-id-format' };
  const sc = findShortcut(rawId);
  if (!sc) return { ok: false, reason: 'unknown-id' };
  return { ok: true, shortcut: sc };
};

// Detect duplicate ids at module load (catches typos in the registry).
const seen = new Set<string>();
for (const s of SHORTCUTS) {
  if (seen.has(s.id)) throw new Error(`duplicate shortcut id: ${s.id}`);
  if (!isValidShortcutId(s.id)) throw new Error(`shortcut id "${s.id}" doesn't match pattern`);
  seen.add(s.id);
}
