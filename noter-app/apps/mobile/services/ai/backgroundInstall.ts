import { AppState } from 'react-native';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { resumePendingModelDownloads } from './modelService';

const TASK_NAME = 'ai-model-install-recovery';

let appStateSubscription: { remove: () => void } | null = null;
let resumePromise: Promise<void> | null = null;
let taskDefined = false;

const runResume = async () => {
  if (resumePromise) {
    return resumePromise;
  }
  resumePromise = resumePendingModelDownloads()
    .catch(() => {})
    .finally(() => {
      resumePromise = null;
    });
  return resumePromise;
};

const ensureTaskDefined = () => {
  if (taskDefined) {
    return;
  }
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      await runResume();
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
  taskDefined = true;
};

export const syncAiBackgroundInstallTask = async () => {
  ensureTaskDefined();
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME).catch(() => false);
  if (registered) {
    return;
  }
  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  }).catch(() => {});
};

export const initializeAiBackgroundInstallRecovery = async () => {
  await syncAiBackgroundInstallTask();
  await runResume();
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runResume().catch(() => {});
      }
    });
  }
};

export const resetAiBackgroundInstallRecoveryForTests = () => {
  appStateSubscription?.remove();
  appStateSubscription = null;
  resumePromise = null;
  taskDefined = false;
};
