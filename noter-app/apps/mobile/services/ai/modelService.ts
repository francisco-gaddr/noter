import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';
import { downloadGgufModel, getModelPath, stopModelDownload, modelFileExists, deleteModelFile } from './ModelDownloader';

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

export type DownloadStage = 'queued' | 'downloading' | 'completed' | 'failed';

/**
 * Download a GGUF model directly to the device for on-device inference via llama.rn.
 * There is NO conversion step (the old MLC GGUF→package flow is gone): the .gguf is
 * the file the engine loads. Returns the local file path, which is stored as the
 * model's `path` and handed to ModelManager.load().
 */
export const downloadModel = async (
    model: HFModel,
    file: HFFile,
    onProgress?: (percent: number) => void,
    options?: {
      onStageChange?: (stage: DownloadStage) => void;
    }
): Promise<string> => {
    const target = getModelPath(model.id, file.quantization);
    if (!target) {
        throw new Error('Native filesystem not available');
    }
    const exists = await modelFileExists(target);
    if (!exists) {
        options?.onStageChange?.('queued');
        try {
            options?.onStageChange?.('downloading');
            await downloadGgufModel(file.url, model.id, file.quantization, onProgress, { name: model.name, totalBytes: file.size });
            options?.onStageChange?.('completed');
        } catch (e) {
            options?.onStageChange?.('failed');
            throw e;
        }
    } else {
        onProgress?.(1);
        options?.onStageChange?.('completed');
    }

    await saveModelLocal({
        id: uuidv4(),
        name: model.name,
        filename: file.filename || (file.quantization ? `${file.quantization}.gguf` : 'model.gguf'),
        path: target,
        size: file.size,
        downloaded: true,
        quantization: file.quantization
    });

    return target;
};

export const deleteModel = async (id: string, path: string) => {
    try {
        await deleteModelFile(path);
        await deleteModelLocal(id);
    } catch (error) {
        console.error("Failed to delete model file:", error);
        // Still delete from DB if file is gone or error
        await deleteModelLocal(id);
    }
};

export const cancelDownload = async (modelId: string): Promise<boolean> => {
    // Stops the in-flight RNFS download (by tracked jobId) and removes the
    // partial .gguf. Returns false if nothing was downloading for this model.
    return stopModelDownload(modelId);
};
