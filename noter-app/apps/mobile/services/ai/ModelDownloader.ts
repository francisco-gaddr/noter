/**
 * On-device GGUF model storage + download.
 *
 * Uses **expo-file-system** (new-architecture native, autolinks cleanly under RN
 * 0.81 + newArchEnabled). The previous react-native-fs@2 is unmaintained and does
 * NOT link into a new-arch EAS build, so its native module was absent — making
 * `DocumentDirectoryPath` undefined and tripping the "requires a dev build" alert
 * even in a real EAS APK. expo-file-system is always present, so on-device models
 * download/save/load correctly.
 *
 * Files live under the app's PRIVATE document directory (sandboxed, not world-
 * readable). GGUF weights are public artifacts; the user's chats/notes are E2E
 * encrypted separately.
 *
 * Background behaviour (#3): a download is owned by THIS module, not by the screen
 * that started it. The download promise + progress live at module scope, so closing
 * the download view, navigating away, or briefly backgrounding the app does NOT stop
 * it. Two things make that robust:
 *   1. The transfer uses iOS's BACKGROUND URLSession (expo-file-system default) so
 *      it survives app suspension; on Android a keep-awake lock held for the whole
 *      transfer keeps the process alive through a screen-lock / app-switch.
 *   2. A subscription API (subscribeDownloads / getDownloadSnapshot) lets the UI
 *      re-attach and show live progress whenever it re-mounts the model list.
 * The ONLY thing that stops a download is an explicit stopModelDownload (cancel).
 */
import * as FileSystem from 'expo-file-system/legacy';
import { acquireKeepAwake } from './keepAwake';

export type DownloadStageValue = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
export interface DownloadState {
  modelId: string;
  percent: number;
  stage: DownloadStageValue;
}

// modelId -> active DownloadResumable, for progress + cancellation.
const activeDownloads = new Map<string, FileSystem.DownloadResumable>();
// modelId -> latest progress/stage, so a re-mounting UI can re-attach (#3).
const downloadState = new Map<string, DownloadState>();
const listeners = new Set<(state: DownloadState) => void>();

const emit = (state: DownloadState) => {
  downloadState.set(state.modelId, state);
  for (const cb of listeners) {
    try { cb(state); } catch { /* ignore listener error */ }
  }
};

const clearState = (modelId: string) => {
  downloadState.delete(modelId);
};

/** Subscribe to download progress/stage changes. Returns an unsubscribe fn. */
export const subscribeDownloads = (cb: (state: DownloadState) => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

/** Current in-flight (or just-finished) download states — for UI re-attach on mount. */
export const getDownloadSnapshot = (): DownloadState[] => Array.from(downloadState.values());

/** True if a download is currently in flight for this model. */
export const isDownloading = (modelId: string): boolean => activeDownloads.has(modelId);

/** documentDirectory is a file:// URI ending in '/'. null only on web/unsupported. */
const getBaseDir = (): string | null => {
  if (!FileSystem.documentDirectory) return null;
  // GGUF files run directly via llama.rn — no conversion, no per-model package dir.
  return `${FileSystem.documentDirectory}llama_models`;
};

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

/** Absolute file:// path of the single GGUF file for a model/quant. */
export const getModelPath = (modelId: string, quantization?: string): string | null => {
  const base = getBaseDir();
  if (!base) return null;
  const quant = (quantization || 'Q4_K_M').toUpperCase();
  return `${base}/${sanitize(modelId)}-${sanitize(quant)}.gguf`;
};

export const ensureModelsDir = async (): Promise<void> => {
  const base = getBaseDir();
  if (!base) throw new Error('Native filesystem not available');
  const info = await FileSystem.getInfoAsync(base);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(base, { intermediates: true });
  }
};

/** True when the file at `uri` exists on disk. */
export const modelFileExists = async (uri: string): Promise<boolean> => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
};

/** Delete a model file (idempotent). */
export const deleteModelFile = async (uri: string): Promise<void> => {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* ignore */ }
};

/**
 * Cancel an in-flight GGUF download and clean up the partial file.
 * Safe no-op if nothing is downloading for that model. This is the ONLY way a
 * download stops short of completion — backgrounding/locking the screen never
 * calls it.
 */
export const stopModelDownload = async (modelId: string): Promise<boolean> => {
  const dl = activeDownloads.get(modelId);
  if (!dl) return false;
  try {
    await dl.cancelAsync();
  } catch {
    /* already finished/cancelled */
  } finally {
    activeDownloads.delete(modelId);
  }
  emit({ modelId, percent: 0, stage: 'cancelled' });
  clearState(modelId);
  const path = getModelPath(modelId);
  if (path) await deleteModelFile(path);
  return true;
};

/**
 * Download a GGUF model file straight to local storage. llama.rn runs the .gguf
 * directly — no zip, no conversion. Returns the absolute file:// path.
 * `onProgress` reports 0..1; the download is cancellable via stopModelDownload.
 */
export const downloadGgufModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void,
): Promise<string> => {
  await ensureModelsDir();
  const target = getModelPath(modelId, quantization);
  if (!target) throw new Error('Model directory unavailable');

  // Remove any stale partial so a re-download starts clean.
  await deleteModelFile(target);

  // Keep the device awake for the whole transfer so a screen-lock or app-switch
  // doesn't suspend the JS engine and pause the download (Android especially).
  const releaseAwake = acquireKeepAwake();
  emit({ modelId, percent: 0, stage: 'queued' });

  const resumable = FileSystem.createDownloadResumable(
    url,
    target,
    // BACKGROUND session (iOS) so the transfer continues while the app is suspended.
    { sessionType: FileSystem.FileSystemSessionType.BACKGROUND },
    (p) => {
      if (!p.totalBytesExpectedToWrite) return;
      const percent = p.totalBytesWritten / p.totalBytesExpectedToWrite;
      onProgress?.(percent);
      emit({ modelId, percent, stage: 'downloading' });
    },
  );
  activeDownloads.set(modelId, resumable);

  let result;
  try {
    result = await resumable.downloadAsync();
  } finally {
    activeDownloads.delete(modelId);
    releaseAwake();
  }

  // cancelAsync() resolves downloadAsync() to undefined — treat as a cancel, not success.
  if (!result) {
    emit({ modelId, percent: 0, stage: 'cancelled' });
    clearState(modelId);
    throw new Error('Download cancelled');
  }
  if (result.status !== 200) {
    await deleteModelFile(target);
    emit({ modelId, percent: 0, stage: 'failed' });
    clearState(modelId);
    throw new Error(`Download failed (HTTP ${result.status})`);
  }
  emit({ modelId, percent: 1, stage: 'completed' });
  clearState(modelId);
  return target;
};

/** True when on-device file storage is available (always true in a native build). */
export const isNativeFileSystemAvailable = (): boolean => Boolean(FileSystem.documentDirectory);
