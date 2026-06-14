let RNFS: any;
try {
  RNFS = require('react-native-fs').default;
} catch {
  RNFS = null;
}

// modelId -> RNFS download jobId, for cancellation.
const activeDownloads = new Map<string, number>();

const getBaseDir = () => {
  if (!RNFS?.DocumentDirectoryPath) return null;
  // GGUF files run directly via llama.rn — no conversion, no per-model package dir.
  return `${RNFS.DocumentDirectoryPath}/llama_models`;
};

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

/** Absolute path of the single GGUF file for a model/quant (the file llama.rn loads). */
export const getModelPath = (modelId: string, quantization?: string) => {
  const base = getBaseDir();
  if (!base) return null;
  const quant = (quantization || 'Q4_K_M').toUpperCase();
  return `${base}/${sanitize(modelId)}-${sanitize(quant)}.gguf`;
};

export const ensureModelsDir = async () => {
  const base = getBaseDir();
  if (!base) throw new Error('Native filesystem not available');
  const exists = await RNFS.exists(base);
  if (!exists) {
    await RNFS.mkdir(base);
  }
};

/**
 * Cancel an in-flight GGUF download (RNFS stopDownload) and clean up the partial
 * file. Safe no-op if nothing is downloading for that model.
 */
export const stopModelDownload = async (modelId: string): Promise<boolean> => {
  const jobId = activeDownloads.get(modelId);
  if (jobId === undefined || !RNFS?.stopDownload) return false;
  try {
    RNFS.stopDownload(jobId);
  } finally {
    activeDownloads.delete(modelId);
  }
  const path = getModelPath(modelId);
  if (path) await RNFS.unlink(path).catch(() => {});
  return true;
};

/**
 * Download a GGUF model file straight to local storage. No zip, no conversion —
 * llama.rn runs the .gguf directly. Returns the absolute file path.
 */
export const downloadGgufModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void
) => {
  await ensureModelsDir();
  const target = getModelPath(modelId, quantization);
  if (!target) throw new Error('Model directory unavailable');

  const download = RNFS.downloadFile({
    fromUrl: url,
    toFile: target,
    background: true,
    discretionary: true,
    progress: (res: { bytesWritten: number; contentLength: number }) => {
      if (!onProgress || !res.contentLength) return;
      onProgress(res.bytesWritten / res.contentLength);
    },
  });
  // Track the RNFS jobId so the download is actually cancellable (see
  // stopModelDownload). Cleared in finally whether it succeeds, fails or cancels.
  if (typeof download.jobId === 'number') activeDownloads.set(modelId, download.jobId);
  let result;
  try {
    result = await download.promise;
  } finally {
    activeDownloads.delete(modelId);
  }
  if (result.statusCode !== 200) {
    await RNFS.unlink(target).catch(() => {});
    throw new Error('Download failed');
  }
  return target;
};

export const isNativeFileSystemAvailable = () => Boolean(RNFS?.DocumentDirectoryPath);
