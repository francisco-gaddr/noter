import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

/**
 * Background-fetch scaffold.
 *
 * Lets iOS/Android wake us up periodically (typically every ~15 min on
 * iOS, every ~15 min on Android, scheduler-dependent) to pull fresh
 * notes/tasks even when the app isn't open. The actual sync work is
 * injected by the caller via `setBackgroundFetchTask()`.
 *
 * iOS background-fetch is gated behind a permission the user grants
 * implicitly by leaving Background App Refresh enabled — there's no
 * runtime prompt. If they've disabled it, the registration succeeds but
 * the task never fires.
 *
 * Android uses WorkManager under the hood (via TaskManager) and is
 * subject to Doze restrictions.
 */

const TASK_NAME = 'noter.background-sync';
const DEFAULT_MIN_INTERVAL_SEC = 15 * 60; // 15 min — iOS-recommended floor.

let registeredHandler: (() => Promise<'no-data' | 'new-data' | 'failed'>) | null = null;

const handler = async (): Promise<BackgroundFetch.BackgroundFetchResult> => {
  if (!registeredHandler) {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
  try {
    const result = await registeredHandler();
    if (result === 'new-data') return BackgroundFetch.BackgroundFetchResult.NewData;
    if (result === 'failed') return BackgroundFetch.BackgroundFetchResult.Failed;
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
};

// Register the task BEFORE any registration calls — TaskManager requires the
// definition to exist at app load. We guard against double-define for
// hot-reload.
if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, handler);
}

/**
 * Set the function that the OS will invoke when we're woken up. Must be
 * idempotent + short (<30s on iOS, after which the OS terminates us).
 *
 * Returns 'new-data' if anything was fetched (extends our future budget),
 * 'no-data' otherwise, 'failed' on a syncable error.
 */
export const setBackgroundFetchTask = (
  fn: () => Promise<'no-data' | 'new-data' | 'failed'>,
): void => {
  registeredHandler = fn;
};

export interface RegisterOptions {
  /** Minimum interval in seconds (default: 15min, iOS floor). */
  minimumIntervalSec?: number;
  /** Continue running while phone is plugged in only (Android). */
  stopOnTerminate?: boolean;
  startOnBoot?: boolean;
}

/**
 * Register the task with the OS scheduler. Idempotent — safe to call on
 * every app launch.
 */
export const registerBackgroundFetch = async (opts: RegisterOptions = {}): Promise<void> => {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied) {
    // User has disabled Background App Refresh — registration would fail
    // silently anyway. Bail out without polluting logs every cold start.
    return;
  }
  try {
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: opts.minimumIntervalSec ?? DEFAULT_MIN_INTERVAL_SEC,
      stopOnTerminate: opts.stopOnTerminate ?? false,
      startOnBoot: opts.startOnBoot ?? Platform.OS === 'android',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[background-fetch] register failed', err);
  }
};

export const unregisterBackgroundFetch = async (): Promise<void> => {
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) {
      await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[background-fetch] unregister failed', err);
  }
};

export const isBackgroundFetchAvailable = async (): Promise<boolean> => {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    return status === BackgroundFetch.BackgroundFetchStatus.Available;
  } catch {
    return false;
  }
};

export const _TASK_NAME = TASK_NAME;
