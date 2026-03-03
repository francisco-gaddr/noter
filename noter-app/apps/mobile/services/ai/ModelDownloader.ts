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
  const result = await download.promise;
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
