import { Platform } from 'react-native';
import { getReactNativeFs, getZipArchive } from './nativeRuntime';

const MODEL_CONFIG_FILE = 'mlc-chat-config.json';

const getBaseDir = () => {
  const RNFS = getReactNativeFs();
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
  const RNFS = getReactNativeFs();
  const base = getBaseDir();
  if (!base) throw new Error('Native filesystem not available');
  const exists = await RNFS.exists(base);
  if (!exists) {
    await RNFS.mkdir(base);
  }
};

const normalizeEntryPath = (entry: any) => {
  if (!entry) return '';
  if (typeof entry.path === 'string' && entry.path) return entry.path;
  if (typeof entry.name === 'string' && entry.name) return entry.name;
  return '';
};

const isDirectoryEntry = (entry: any) => {
  if (!entry) return false;
  if (typeof entry.isDirectory === 'function') return Boolean(entry.isDirectory());
  if (typeof entry.isDirectory === 'boolean') return entry.isDirectory;
  if (typeof entry.type === 'string') return entry.type === 'directory';
  return false;
};

const getEntryName = (entry: any) => {
  if (!entry) return '';
  if (typeof entry.name === 'string' && entry.name) return entry.name;
  const entryPath = normalizeEntryPath(entry);
  if (!entryPath) return '';
  return entryPath.split('/').pop() || '';
};

const hasRequiredArtifacts = async (path: string) => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.exists) return false;
  const configPath = `${path}/${MODEL_CONFIG_FILE}`;
  if (!(await RNFS.exists(configPath))) {
    return false;
  }

  if (typeof RNFS.readDir === 'function') {
    try {
      const entries = await RNFS.readDir(path);
      const fileNames = entries.filter((entry: any) => !isDirectoryEntry(entry)).map((entry: any) => getEntryName(entry));
      const hasParamShard = fileNames.some((name: string) => /^params(?:_shard)?[_0-9a-z.-]*\.(?:bin|params)$/i.test(name));
      if (hasParamShard) {
        return true;
      }
    } catch {}
  }

  if (typeof RNFS.readFile === 'function') {
    try {
      const raw = await RNFS.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      const referencedFiles = [
        ...(Array.isArray(parsed?.params_shards) ? parsed.params_shards : []),
        ...(Array.isArray(parsed?.tokenizer_files) ? parsed.tokenizer_files : []),
        parsed?.tokenizer_model,
        parsed?.tokenizer_json,
        parsed?.params_path,
      ].filter((value) => typeof value === 'string' && value);

      if (referencedFiles.length === 0) {
        return true;
      }

      for (const file of referencedFiles) {
        const normalized = String(file).replace(/^\.\/+/, '');
        if (!(await RNFS.exists(`${path}/${normalized}`))) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  return true;
};

export const findModelPackageRoot = async (path: string, maxDepth = 3): Promise<string | null> => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.exists || !path) return null;

  const configPath = `${path}/${MODEL_CONFIG_FILE}`;
  if (await RNFS.exists(configPath)) {
    return path;
  }

  if (maxDepth <= 0 || typeof RNFS.readDir !== 'function') {
    return null;
  }

  let entries: any[] = [];
  try {
    entries = await RNFS.readDir(path);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!isDirectoryEntry(entry)) continue;
    const entryPath = normalizeEntryPath(entry);
    if (!entryPath) continue;
    const nested = await findModelPackageRoot(entryPath, maxDepth - 1);
    if (nested) return nested;
  }

  return null;
};

export const validateModelPackage = async (path: string) => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.exists || !path) {
    throw new Error('Native filesystem not available');
  }

  const resolvedPath = await findModelPackageRoot(path);
  if (!resolvedPath) {
    throw new Error('Invalid model package');
  }

  const validArtifacts = await hasRequiredArtifacts(resolvedPath);
  if (!validArtifacts) {
    throw new Error('Invalid model package');
  }

  return resolvedPath;
};

export const downloadCompiledModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void
) => {
  const RNFS = getReactNativeFs();
  const ZipArchive = getZipArchive();
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
  return validateModelPackage(modelDir);
};

export const getPlatformTarget = () => (Platform.OS === 'ios' ? 'iphone' : 'android');

export const isNativeFileSystemAvailable = () => Boolean(getReactNativeFs()?.DocumentDirectoryPath);
