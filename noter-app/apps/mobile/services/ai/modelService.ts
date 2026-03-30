import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { downloadCompiledModel, getModelDir, getPlatformTarget, validateModelPackage } from './ModelDownloader';
import { requestModelConversion, getConversionStatus, getCompiledModelUrl } from './huggingface';
import { getReactNativeFs } from './nativeRuntime';
import { convertGGUFToMLC, getLocalConversionCapabilities } from './native/MLCModule';
import {
    getModelInstallSessionKey,
    listModelInstallSessions,
    patchModelInstallSession,
    removeModelInstallSession,
    upsertModelInstallSession,
} from './installSession';

const getModelsDir = () => {
  const RNFS = getReactNativeFs();
  return RNFS?.DocumentDirectoryPath ? `${RNFS.DocumentDirectoryPath}/mlc_models/` : '';
};

export const MODELS_DIR = getModelsDir();

export type StoredModelRecord = {
    id: string;
    name: string;
    filename: string;
    path: string;
    size: number;
    quantization?: string;
    downloaded: boolean;
};

const sanitizeRecordId = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

export const getInstalledModelRecordId = (modelId: string, quantization?: string) =>
    `model_${sanitizeRecordId(modelId)}_${sanitizeRecordId((quantization || 'Q4_K_M').toUpperCase())}`;

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
    | 'local_conversion_requested'
    | 'local_conversion_unavailable'
    | 'local_conversion_failed'
    | 'checking_compiled'
    | 'converting_server'
    | 'downloading_gguf'
    | 'downloading_compiled'
    | 'downloading'
    | 'converting'
    | 'converting_locally'
    | 'zipping'
    | 'validating'
    | 'completed'
    | 'failed';

type DownloadOptions = {
    preferLocalConversion?: boolean;
    strictLocalConversion?: boolean;
    onStageChange?: (stage: DownloadStage) => void;
    existingJobId?: string;
};

const updateInstallProgress = async (
    sessionKey: string,
    stage: DownloadStage,
    progress: number,
    onProgress?: (percent: number) => void,
    onStageChange?: (stage: DownloadStage) => void,
    extra?: Partial<{ jobId: string; outputUrl: string }>
) => {
    onStageChange?.(stage);
    onProgress?.(progress);
    await patchModelInstallSession(sessionKey, {
        stage,
        progress,
        ...(extra || {}),
    });
};

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

    onStageChange?.('downloading_gguf');
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
    options?: DownloadOptions
): Promise<string> => {
    const RNFS = getReactNativeFs();
    const platform = getPlatformTarget();
    const modelDir = getModelDir(model.id, file.quantization);
    const sessionKey = getModelInstallSessionKey(model.id, file.quantization);
    if (!modelDir) {
        throw new Error('Native filesystem not available');
    }
    await upsertModelInstallSession({
        key: sessionKey,
        model,
        file,
        preferLocalConversion: Boolean(options?.preferLocalConversion),
        strictLocalConversion: Boolean(options?.strictLocalConversion),
        stage: 'queued',
        progress: 0,
        platform,
        jobId: options?.existingJobId,
        updatedAt: new Date().toISOString(),
    });
    const exists = await RNFS.exists(modelDir);
    let resolvedModelDir = modelDir;
    try {
        if (!exists) {
            await updateInstallProgress(sessionKey, 'queued', 0, onProgress, options?.onStageChange, options?.existingJobId ? { jobId: options.existingJobId } : undefined);
        if (options?.preferLocalConversion) {
            await updateInstallProgress(sessionKey, 'local_conversion_requested', 0.02, onProgress, options?.onStageChange);
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
                await updateInstallProgress(
                    sessionKey,
                    String((error as any)?.message || '').includes('Local conversion unsupported') ? 'local_conversion_unavailable' : 'local_conversion_failed',
                    0.05,
                    onProgress,
                    options?.onStageChange
                );
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
            await updateInstallProgress(sessionKey, 'checking_compiled', 0.1, onProgress, options?.onStageChange);
            const compiled = await getCompiledModelUrl({
                modelId: model.id,
                quantization: file.quantization,
                platform
            });
            let outputUrl: string | undefined = compiled.available ? compiled.url : undefined;
            let jobId = options?.existingJobId;

            if (!outputUrl && !jobId) {
                const created = await requestModelConversion({
                    modelId: model.id,
                    ggufUrl: file.url,
                    quantization: file.quantization,
                    platform
                });
                jobId = created.jobId;
                await patchModelInstallSession(sessionKey, {
                    jobId,
                    stage: 'converting_server',
                    progress: 0.15,
                });
            }

            const maxAttempts = 120;
            if (!outputUrl && jobId) {
                for (let i = 0; i < maxAttempts; i += 1) {
                    const status = await getConversionStatus(jobId);
                    await updateInstallProgress(
                        sessionKey,
                        status.status === 'downloading' ? 'downloading_gguf' : status.status === 'converting' ? 'converting_server' : status.status === 'zipping' ? 'zipping' : (status.status as DownloadStage),
                        typeof status.progress === 'number' ? Math.min(0.9, Math.max(0, status.progress)) : 0.2,
                        onProgress,
                        options?.onStageChange,
                        { jobId, outputUrl: status.outputUrl }
                    );
                    if (status.status === 'completed') {
                        outputUrl = status.outputUrl;
                        break;
                    }
                    if (status.status === 'failed') {
                        const compiledFallback = await getCompiledModelUrl({
                            modelId: model.id,
                            quantization: file.quantization,
                            platform
                        });
                        if (compiledFallback.available) {
                            outputUrl = compiledFallback.url;
                            break;
                        }
                        throw new Error(status.message || 'Conversion failed');
                    }
                    await sleep(2000);
                }
            }

            if (!outputUrl) {
                const compiledFallback = await getCompiledModelUrl({
                    modelId: model.id,
                    quantization: file.quantization,
                    platform
                });
                if (!compiledFallback.available) {
                    throw new Error('Conversion failed');
                }
                outputUrl = compiledFallback.url;
            }

            await updateInstallProgress(sessionKey, 'downloading_compiled', 0.92, onProgress, options?.onStageChange, { jobId: jobId || '', outputUrl });
            resolvedModelDir = await downloadCompiledModel(outputUrl, model.id, file.quantization, (p) => {
                const nextProgress = 0.92 + p * 0.06;
                onProgress?.(nextProgress);
                patchModelInstallSession(sessionKey, { stage: 'downloading_compiled', progress: nextProgress }).catch(() => {});
            });
            await updateInstallProgress(sessionKey, 'validating', 0.99, onProgress, options?.onStageChange, { jobId: jobId || '', outputUrl });
            resolvedModelDir = await validateModelPackage(resolvedModelDir);
        } else {
            resolvedModelDir = validExistingPath;
        }
        } else {
            await updateInstallProgress(sessionKey, 'validating', 0.98, onProgress, options?.onStageChange);
            try {
                resolvedModelDir = await validateModelPackage(modelDir);
            } catch {
                await swallowAsync(RNFS.unlink(modelDir));
                await removeModelInstallSession(sessionKey);
                return downloadModel(model, file, onProgress, options);
            }
        }

        const filename = (file.quantization ? `${file.quantization}.zip` : 'model.zip');
        await saveModelLocal({
            id: getInstalledModelRecordId(model.id, file.quantization),
            name: model.name,
            filename: filename,
            path: resolvedModelDir,
            size: file.size,
            downloaded: true,
            quantization: file.quantization
        });
        await updateInstallProgress(sessionKey, 'completed', 1, onProgress, options?.onStageChange);
        await removeModelInstallSession(sessionKey);

        return resolvedModelDir;
    } catch (error) {
        await patchModelInstallSession(sessionKey, {
            stage: 'failed',
            progress: 0,
        });
        throw error;
    }
};

export const prepareModelForChat = async (path: string) => {
    return validateModelPackage(path);
};

export const normalizeStoredModelRecord = async (model: StoredModelRecord) => {
    const preparedPath = await validateModelPackage(model.path);
    if (preparedPath === model.path) {
        return model;
    }
    const normalized = {
        ...model,
        path: preparedPath,
    };
    await saveModelLocal(normalized);
    return normalized;
};

export const resumePendingModelDownloads = async (handlers?: {
    onProgress?: (modelId: string, percent: number) => void;
    onStageChange?: (modelId: string, stage: DownloadStage) => void;
    onCompleted?: (modelId: string, path: string) => void;
    onFailed?: (modelId: string, error: unknown) => void;
}) => {
    const sessions = await listModelInstallSessions();
    for (const session of sessions) {
        if (session.stage === 'completed') {
            await removeModelInstallSession(session.key);
            continue;
        }
        if (session.stage === 'failed') {
            continue;
        }
        try {
            const path = await downloadModel(
                session.model,
                session.file,
                handlers?.onProgress ? (percent) => handlers.onProgress?.(session.model.id, percent) : undefined,
                {
                    preferLocalConversion: session.preferLocalConversion,
                    strictLocalConversion: session.strictLocalConversion,
                    existingJobId: session.jobId,
                    onStageChange: handlers?.onStageChange ? (stage) => handlers.onStageChange?.(session.model.id, stage) : undefined,
                }
            );
            handlers?.onCompleted?.(session.model.id, path);
        } catch (error) {
            handlers?.onFailed?.(session.model.id, error);
        }
    }
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
