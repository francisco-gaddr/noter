import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';
import { Platform } from 'react-native';
import { downloadCompiledModel, getModelDir, getPlatformTarget, stopModelDownload } from './ModelDownloader';
import { requestModelConversion, getConversionStatus, getCompiledModelUrl } from './huggingface';
import { canConvertLocally, convertGGUFToMLC } from './native/MLCModule';

// Try to load RNFS safely
let RNFS: any;
try {
  RNFS = require("react-native-fs").default;
} catch (e) {
  RNFS = null;
}

export const MODELS_DIR = RNFS?.DocumentDirectoryPath ? `${RNFS.DocumentDirectoryPath}/mlc_models/` : '';

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

export const downloadModel = async (
    model: HFModel, 
    file: HFFile, 
    onProgress?: (percent: number) => void,
    options?: {
      preferLocalConversion?: boolean;
      onStageChange?: (stage: 'queued' | 'downloading' | 'converting' | 'converting_locally' | 'zipping' | 'completed' | 'failed') => void;
    }
): Promise<string> => {
    const platform = getPlatformTarget();
    const modelDir = getModelDir(model.id, file.quantization);
    if (!modelDir) {
        throw new Error('Native filesystem not available');
    }
    const exists = await RNFS.exists(modelDir);
    if (!exists) {
        options?.onStageChange?.('queued');

        // On-device path: when the user opted into local conversion AND the native
        // MLC converter is linked, download the raw GGUF and convert it to MLC
        // format ON THE DEVICE — no server round-trip. The model then loads from
        // modelDir for fully-local chat. (Falls back to the server path below if
        // the converter isn't available, e.g. Expo Go or an older build.)
        if (options?.preferLocalConversion && canConvertLocally() && RNFS) {
            const target: 'iphone' | 'android' = Platform.OS === 'ios' ? 'iphone' : 'android';
            const ggufPath = `${MODELS_DIR}${model.id.replace(/[^a-zA-Z0-9._-]/g, '_')}-${file.quantization || 'model'}.gguf`;
            await RNFS.mkdir(MODELS_DIR).catch(() => {});
            options?.onStageChange?.('downloading');
            const dl = RNFS.downloadFile({
                fromUrl: file.url,
                toFile: ggufPath,
                progressDivider: 5,
                progress: (r: { bytesWritten: number; contentLength: number }) => {
                    if (r.contentLength > 0) onProgress?.(Math.min(0.6, (r.bytesWritten / r.contentLength) * 0.6));
                },
            });
            await dl.promise;
            options?.onStageChange?.('converting_locally');
            await convertGGUFToMLC(ggufPath, modelDir, file.quantization || 'Q4_K_M', target);
            // The raw GGUF is no longer needed once compiled — reclaim the space.
            await RNFS.unlink(ggufPath).catch(() => {});
            onProgress?.(1);
            options?.onStageChange?.('completed');

            const filenameLocal = (file.quantization ? `${file.quantization}.zip` : 'model.zip');
            await saveModelLocal({
                id: uuidv4(), name: model.name, filename: filenameLocal, path: modelDir,
                size: file.size, downloaded: true, quantization: file.quantization,
            });
            return modelDir;
        }

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
            const nextStage = status.status === 'converting' && options?.preferLocalConversion ? 'converting_locally' : status.status;
            options?.onStageChange?.(nextStage as any);
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
            await new Promise(resolve => setTimeout(resolve, 2000));
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
        await downloadCompiledModel(outputUrl, model.id, file.quantization, (p) => {
            onProgress?.(0.9 + p * 0.1);
        });
        options?.onStageChange?.('completed');
    }

    const filename = (file.quantization ? `${file.quantization}.zip` : 'model.zip');
    await saveModelLocal({
        id: uuidv4(),
        name: model.name,
        filename: filename,
        path: modelDir,
        size: file.size,
        downloaded: true,
        quantization: file.quantization
    });

    return modelDir;
};

export const deleteModel = async (id: string, path: string) => {
    try {
        await RNFS.unlink(path).catch(() => {});
        await deleteModelLocal(id);
    } catch (error) {
        console.error("Failed to delete model file:", error);
        // Still delete from DB if file is gone or error
        await deleteModelLocal(id);
    }
};

export const cancelDownload = async (modelId: string): Promise<boolean> => {
    // Stops the in-flight RNFS download (by tracked jobId) and removes the
    // partial zip. Returns false if nothing was downloading for this model.
    return stopModelDownload(modelId);
};
