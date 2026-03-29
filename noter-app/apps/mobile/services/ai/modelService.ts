import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';
import { downloadCompiledModel, getModelDir, getPlatformTarget, validateModelPackage } from './ModelDownloader';
import { requestModelConversion, getConversionStatus, getCompiledModelUrl } from './huggingface';
import { getReactNativeFs } from './nativeRuntime';
import { convertGGUFToMLC, getLocalConversionCapabilities } from './native/MLCModule';

const getModelsDir = () => {
  const RNFS = getReactNativeFs();
  return RNFS?.DocumentDirectoryPath ? `${RNFS.DocumentDirectoryPath}/mlc_models/` : '';
};

export const MODELS_DIR = getModelsDir();

export const getBestQuantization = (files: HFFile[]): HFFile | undefined => {
    // Priority list for mobile (balance size/performance)
    // 1. Q4_K_M (Best balance)
    // 2. Q5_K_M (Better quality, slightly larger)
    // 3. Q4_0 (Legacy, fast)
    // 4. Q5_0
    // 5. Q8_0 (Large)
    // Avoid f16/f32 unless nothing else exists (but likely too big)
    
    const priorities = ['Q4_K_M', 'Q5_K_M', 'Q4_0', 'Q5_0', 'Q8_0'];
    
    for (const quant of priorities) {
        const file = files.find(f => f.quantization === quant);
        if (file) return file;
    }
    
    // Fallback: pick smallest non-f16/f32 if possible, or just smallest
    const candidates = files.filter(f => !f.quantization?.match(/F16|F32/i));
    if (candidates.length > 0) {
        return candidates.sort((a, b) => a.size - b.size)[0];
    }
    
    return files.sort((a, b) => a.size - b.size)[0];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const swallowAsync = async (operation: unknown) => {
    try {
        await Promise.resolve(operation);
    } catch {}
};

type DownloadStage =
    | 'queued'
    | 'downloading'
    | 'converting'
    | 'converting_locally'
    | 'zipping'
    | 'validating'
    | 'completed'
    | 'failed';

const tryLocalConversion = async (
    RNFS: any,
    model: HFModel,
    file: HFFile,
    modelDir: string,
    platform: 'iphone' | 'android',
    onProgress?: (percent: number) => void,
    onStageChange?: (stage: DownloadStage) => void
) => {
    const capabilities = await getLocalConversionCapabilities();
    if (!capabilities.engineAvailable || !capabilities.converterAvailable) {
        throw new Error('Local conversion unsupported');
    }

    await swallowAsync(RNFS.mkdir(modelDir));
    const tempDir = `${RNFS.DocumentDirectoryPath}/mlc_models_tmp`;
    await swallowAsync(RNFS.mkdir(tempDir));
    const safeModelId = model.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const safeQuantization = (file.quantization || 'Q4_K_M').toUpperCase().replace(/[^a-zA-Z0-9._-]+/g, '_');
    const ggufPath = `${tempDir}/${safeModelId}_${safeQuantization}.gguf`;

    onStageChange?.('downloading');
    const download = RNFS.downloadFile({
        fromUrl: file.url,
        toFile: ggufPath,
        background: true,
        discretionary: true,
        progress: (res: { bytesWritten: number; contentLength: number }) => {
            if (!onProgress || !res.contentLength) return;
            onProgress(Math.min(0.6, (res.bytesWritten / res.contentLength) * 0.6));
        },
    });
    const result = await download.promise;
    if (result.statusCode !== 200) {
        await swallowAsync(RNFS.unlink(ggufPath));
        throw new Error('Failed to download GGUF');
    }

    onStageChange?.('converting_locally');
    onProgress?.(0.7);
    const convertedPath = await convertGGUFToMLC(ggufPath, modelDir, file.quantization || 'Q4_K_M', platform);
    const finalPath = typeof convertedPath === 'string' && convertedPath ? convertedPath : modelDir;
    onStageChange?.('validating');
    const validatedPath = await validateModelPackage(finalPath);
    await swallowAsync(RNFS.unlink(ggufPath));
    onProgress?.(1);
    onStageChange?.('completed');
    return validatedPath;
};

export const downloadModel = async (
    model: HFModel, 
    file: HFFile, 
    onProgress?: (percent: number) => void,
    options?: {
      preferLocalConversion?: boolean;
      strictLocalConversion?: boolean;
      onStageChange?: (stage: DownloadStage) => void;
    }
): Promise<string> => {
    const RNFS = getReactNativeFs();
    const platform = getPlatformTarget();
    const modelDir = getModelDir(model.id, file.quantization);
    if (!modelDir) {
        throw new Error('Native filesystem not available');
    }
    const exists = await RNFS.exists(modelDir);
    let resolvedModelDir = modelDir;
    if (!exists) {
        options?.onStageChange?.('queued');
        if (options?.preferLocalConversion) {
            try {
                resolvedModelDir = await tryLocalConversion(
                    RNFS,
                    model,
                    file,
                    modelDir,
                    platform,
                    onProgress,
                    options?.onStageChange
                );
            } catch (error) {
                if (options?.strictLocalConversion) {
                    throw error;
                }
            }
        }

        let validExistingPath: string | null = null;
        try {
            validExistingPath = await validateModelPackage(resolvedModelDir);
        } catch {}

        if (!validExistingPath) {
            const { jobId } = await requestModelConversion({
                modelId: model.id,
                ggufUrl: file.url,
                quantization: file.quantization,
                platform
            });

            const maxAttempts = 120;
            let outputUrl: string | undefined;
            for (let i = 0; i < maxAttempts; i += 1) {
                const status = await getConversionStatus(jobId);
                options?.onStageChange?.(status.status as any);
                if (typeof status.progress === 'number') {
                    onProgress?.(Math.min(0.9, Math.max(0, status.progress)));
                }
                if (status.status === 'completed') {
                    outputUrl = status.outputUrl;
                    break;
                }
                if (status.status === 'failed') {
                    throw new Error(status.message || 'Conversion failed');
                }
                await sleep(2000);
            }

            if (!outputUrl) {
                const compiled = await getCompiledModelUrl({
                    modelId: model.id,
                    quantization: file.quantization,
                    platform
                });
                outputUrl = compiled.url;
            }

            options?.onStageChange?.('downloading');
            resolvedModelDir = await downloadCompiledModel(outputUrl, model.id, file.quantization, (p) => {
                onProgress?.(0.9 + p * 0.1);
            });
            options?.onStageChange?.('validating');
            resolvedModelDir = await validateModelPackage(resolvedModelDir);
            options?.onStageChange?.('completed');
        } else {
            resolvedModelDir = validExistingPath;
        }
    } else {
        options?.onStageChange?.('validating');
        try {
            resolvedModelDir = await validateModelPackage(modelDir);
        } catch {
            await swallowAsync(RNFS.unlink(modelDir));
            return downloadModel(model, file, onProgress, options);
        }
        options?.onStageChange?.('completed');
    }

    const filename = (file.quantization ? `${file.quantization}.zip` : 'model.zip');
    await saveModelLocal({
        id: uuidv4(),
        name: model.name,
        filename: filename,
        path: resolvedModelDir,
        size: file.size,
        downloaded: true,
        quantization: file.quantization
    });

    return resolvedModelDir;
};

export const prepareModelForChat = async (path: string) => {
    return validateModelPackage(path);
};

export const deleteModel = async (id: string, path: string) => {
    const RNFS = getReactNativeFs();
    try {
        await swallowAsync(RNFS.unlink(path));
        await deleteModelLocal(id);
    } catch (error) {
        console.error("Failed to delete model file:", error);
        // Still delete from DB if file is gone or error
        await deleteModelLocal(id);
    }
};

export const cancelDownload = async (modelId: string) => {
    // RNFS download cancellation requires job ID. 
    // In this simple impl, we don't track job IDs globally exposed yet.
    // For now, no-op or implement job tracking map if needed.
    console.warn("Cancel download not fully implemented for RNFS");
};
