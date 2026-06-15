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
 */
import * as FileSystem from 'expo-file-system/legacy';

// modelId -> active DownloadResumable, for progress + cancellation.
const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

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
 * Safe no-op if nothing is downloading for that model.
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

  const resumable = FileSystem.createDownloadResumable(
    url,
    target,
    {},
    (p) => {
      if (!onProgress || !p.totalBytesExpectedToWrite) return;
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    },
  );
  activeDownloads.set(modelId, resumable);

  let result;
  try {
    result = await resumable.downloadAsync();
  } finally {
    activeDownloads.delete(modelId);
  }

  // cancelAsync() resolves downloadAsync() to undefined — treat as a cancel, not success.
  if (!result) throw new Error('Download cancelled');
  if (result.status !== 200) {
    await deleteModelFile(target);
    throw new Error(`Download failed (HTTP ${result.status})`);
  }
  return target;
};

/** True when on-device file storage is available (always true in a native build). */
export const isNativeFileSystemAvailable = (): boolean => Boolean(FileSystem.documentDirectory);
