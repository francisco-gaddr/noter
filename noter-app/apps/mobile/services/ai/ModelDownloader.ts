import { Platform } from 'react-native';
import { getReactNativeFs, getZipArchive } from './nativeRuntime';

const MODEL_CONFIG_FILE = 'mlc-chat-config.json';
const PACKAGE_SCAN_MAX_DEPTH = 12;
const PACKAGE_LIST_MAX_DEPTH = 10;
const VALIDATION_RETRY_DELAY_MS = 350;
const VALIDATION_RETRY_ATTEMPTS = 8;

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

const normalizeRelativePath = (value: string) => {
  const parts = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (normalized.length > 0) normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
};

const listRelativeFiles = async (rootPath: string, maxDepth = PACKAGE_LIST_MAX_DEPTH, prefix = ''): Promise<string[]> => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.readDir || maxDepth < 0) return [];
  let entries: any[] = [];
  try {
    entries = await RNFS.readDir(rootPath);
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    const entryName = getEntryName(entry);
    if (!entryName) continue;
    const relativePath = normalizeRelativePath(prefix ? `${prefix}/${entryName}` : entryName);
    const entryPath = normalizeEntryPath(entry) || `${rootPath}/${entryName}`;
    if (isDirectoryEntry(entry)) {
      if (maxDepth > 0) {
        results.push(...(await listRelativeFiles(entryPath, maxDepth - 1, relativePath)));
      }
      continue;
    }
    results.push(relativePath);
  }
  return results;
};

const hasRequiredArtifacts = async (path: string) => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.exists) return false;
  const configPath = `${path}/${MODEL_CONFIG_FILE}`;
  if (!(await RNFS.exists(configPath))) {
    return false;
  }

  const relativeFiles = typeof RNFS.readDir === 'function' ? await listRelativeFiles(path, PACKAGE_LIST_MAX_DEPTH) : [];
  const relativeFileSet = new Set(relativeFiles.map((file) => normalizeRelativePath(file)));
  const hasParamShard = relativeFiles.some((file) => /^params(?:_shard)?[_0-9a-z.-]*\.(?:bin|params)$/i.test(file.split('/').pop() || ''));

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
        return hasParamShard;
      }

      for (const file of referencedFiles) {
        const normalized = normalizeRelativePath(String(file));
        const fileName = normalized.split('/').pop() || normalized;
        if (!relativeFileSet.has(normalized) && !relativeFiles.some((relativePath) => relativePath.split('/').pop() === fileName)) {
          return false;
        }
      }
      return true;
    } catch {
      return hasParamShard;
    }
  }

  return hasParamShard;
};

export const findModelPackageRoot = async (path: string, maxDepth = PACKAGE_SCAN_MAX_DEPTH, visited = new Set<string>()): Promise<string | null> => {
  const RNFS = getReactNativeFs();
  if (!RNFS?.exists || !path) return null;
  if (visited.has(path)) return null;
  visited.add(path);

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

  if (entries.some((entry) => !isDirectoryEntry(entry) && getEntryName(entry) === MODEL_CONFIG_FILE)) {
    return path;
  }

  for (const entry of entries) {
    if (!isDirectoryEntry(entry)) continue;
    const entryPath = normalizeEntryPath(entry);
    if (!entryPath) continue;
    const nested = await findModelPackageRoot(entryPath, maxDepth - 1, visited);
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
    throw new Error('Invalid model package: package root not found');
  }

  const validArtifacts = await hasRequiredArtifacts(resolvedPath);
  if (!validArtifacts) {
    throw new Error('Invalid model package: missing model artifacts');
  }

  return resolvedPath;
};

export const validateModelPackageWithRetry = async (
  path: string,
  attempts = VALIDATION_RETRY_ATTEMPTS,
  delayMs = VALIDATION_RETRY_DELAY_MS
) => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await validateModelPackage(path);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

export const downloadCompiledModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void,
  onJobCreated?: (jobId: number) => void
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
  if (typeof download?.jobId === 'number') {
    onJobCreated?.(download.jobId);
  }
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
  return validateModelPackageWithRetry(modelDir);
};

export const getPlatformTarget = () => (Platform.OS === 'ios' ? 'iphone' : 'android');

export const isNativeFileSystemAvailable = () => Boolean(getReactNativeFs()?.DocumentDirectoryPath);
