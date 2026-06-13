/**
 * Writes the task-widget snapshot to the OS shared container the native widget
 * reads. The snapshot shape + sort/filter live in @repo/shared (widgetData), so
 * this module only derives the inputs from app state and hands the JSON to an
 * injected native bridge — keeping it testable without a native module.
 *
 * See Doc/widgets-architecture.md for the native side (App Group / EncryptedSharedPreferences).
 */
import { buildWidgetSnapshot, type WidgetQuery, type Task, type Note } from '@repo/shared';

export interface WidgetBridge {
  /** True only when the native widget module is present (false in Expo Go / tests). */
  isAvailable: () => boolean;
  /** Persist the JSON snapshot to the shared container and reload the widget timelines. */
  writeSnapshot: (json: string) => Promise<void>;
}

/** Task lists are notes of type `task_list`; the widget's list filter uses these. */
export const deriveWidgetLists = (notes: Note[]): { id: string; name: string }[] =>
  notes
    .filter((n) => (n as any).type === 'task_list')
    .map((n) => ({ id: n._id, name: n.title || 'Lista' }));

/**
 * Build + write the widget snapshot. No-ops (returns false) when the native
 * bridge is unavailable, so it is always safe to call after a data change.
 */
export const writeWidgetSnapshot = async (
  notes: Note[],
  tasks: Task[],
  bridge: WidgetBridge,
  now: string,
  query: WidgetQuery = {},
): Promise<boolean> => {
  if (!bridge.isAvailable()) return false;
  const snapshot = buildWidgetSnapshot(tasks, deriveWidgetLists(notes), now, query);
  await bridge.writeSnapshot(JSON.stringify(snapshot));
  return true;
};

/**
 * Default bridge backed by an optional native module (`NoterWidget`). Resolves
 * lazily so the absence of the native module (Expo Go, web, tests) is a clean
 * no-op rather than a crash. The native module is added by the widget config
 * plugin (pending — see the architecture doc).
 */
export const createNativeWidgetBridge = (nativeModule?: { writeSnapshot?: (json: string) => Promise<void> } | null): WidgetBridge => ({
  isAvailable: () => typeof nativeModule?.writeSnapshot === 'function',
  writeSnapshot: async (json: string) => {
    if (typeof nativeModule?.writeSnapshot === 'function') await nativeModule.writeSnapshot(json);
  },
});
