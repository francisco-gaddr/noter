import { Platform } from 'react-native';

let RNFS: any;
try {
  RNFS = require('react-native-fs').default;
} catch {
  RNFS = null;
}

let ZipArchive: any;
try {
  ZipArchive = require('react-native-zip-archive');
} catch {
  ZipArchive = null;
}

// modelId -> RNFS download jobId, for cancellation.
const activeDownloads = new Map<string, number>();

/**
 * Cancel an in-flight model download (RNFS stopDownload) and clean up the
 * partial zip. Safe no-op if nothing is downloading for that model.
 */
export const stopModelDownload = async (modelId: string): Promise<boolean> => {
  const jobId = activeDownloads.get(modelId);
  if (jobId === undefined || !RNFS?.stopDownload) return false;
  try {
    RNFS.stopDownload(jobId);
  } finally {
    activeDownloads.delete(modelId);
  }
  const dir = getModelDir(modelId);
  if (dir) await RNFS.unlink(`${dir}/model.zip`).catch(() => {});
  return true;
};

const getBaseDir = () => {
  if (!RNFS?.DocumentDirectoryPath) return null;
  return `${RNFS.DocumentDirectoryPath}/mlc_models`;
};

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

export const getModelDir = (modelId: string, quantization?: string) => {
  const base = getBaseDir();
  if (!base) return null;
  const quant = (quantization || 'Q4_K_M').toUpperCase();
  return `${base}/${sanitize(modelId)}/${sanitize(quant)}`;
};

export const ensureModelsDir = async () => {
  const base = getBaseDir();
  if (!base) throw new Error('Native filesystem not available');
  const exists = await RNFS.exists(base);
  if (!exists) {
    await RNFS.mkdir(base);
  }
};

export const downloadCompiledModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void
) => {
  await ensureModelsDir();
  const modelDir = getModelDir(modelId, quantization);
  if (!modelDir) throw new Error('Model directory unavailable');
  const exists = await RNFS.exists(modelDir);
  if (!exists) {
    await RNFS.mkdir(modelDir);
  }

  const zipPath = `${modelDir}/model.zip`;
  const download = RNFS.downloadFile({
    fromUrl: url,
    toFile: zipPath,
    background: true,
    discretionary: true,
    progress: (res: { bytesWritten: number; contentLength: number }) => {
      if (!onProgress || !res.contentLength) return;
      const percent = res.bytesWritten / res.contentLength;
      onProgress(percent);
    },
  });
  // Track the RNFS jobId so the download is actually cancellable (see
  // stopModelDownload). Cleared in finally whether it succeeds, fails or is
  // cancelled.
  if (typeof download.jobId === 'number') activeDownloads.set(modelId, download.jobId);
  let result;
  try {
    result = await download.promise;
  } finally {
    activeDownloads.delete(modelId);
  }
  if (result.statusCode !== 200) {
    await RNFS.unlink(zipPath).catch(() => {});
    throw new Error('Download failed');
  }

  if (!ZipArchive?.unzip) {
    throw new Error('Zip module not available');
  }

  await ZipArchive.unzip(zipPath, modelDir);
  await RNFS.unlink(zipPath).catch(() => {});

  const configPath = `${modelDir}/mlc-chat-config.json`;
  const configExists = await RNFS.exists(configPath);
  if (!configExists) {
    throw new Error('Invalid model package');
  }

  return modelDir;
};

export const getPlatformTarget = () => (Platform.OS === 'ios' ? 'iphone' : 'android');

export const isNativeFileSystemAvailable = () => Boolean(RNFS?.DocumentDirectoryPath);
