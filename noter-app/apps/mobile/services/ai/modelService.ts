import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';
import { downloadGgufModel, getModelPath, stopModelDownload, verifyModelFile, deleteModelFile } from './ModelDownloader';

export const getBestQuantization = (files: HFFile[]): HFFile | undefined => {
    // Guard: callers pass the result of an async file fetch that may have failed → undefined/null.
    // A bad input must return undefined, never throw (it runs inside the search result loop).
    const safe = (Array.isArray(files) ? files : []).filter((f) => f && typeof f === 'object');
    if (safe.length === 0) return undefined;
    const bySize = (a: HFFile, b: HFFile) => (Number(a?.size) || 0) - (Number(b?.size) || 0);

    // Priority list for mobile (balance size/performance):
    // Q4_K_M (best balance) → Q5_K_M → Q4_0 → Q5_0 → Q8_0. Avoid f16/f32 unless nothing else exists.
    const priorities = ['Q4_K_M', 'Q5_K_M', 'Q4_0', 'Q5_0', 'Q8_0'];

    for (const quant of priorities) {
        const file = safe.find(f => f.quantization === quant);
        if (file) return file;
    }

    // Fallback: smallest non-f16/f32 if possible, else just the smallest.
    const candidates = safe.filter(f => !String(f.quantization || '').match(/F16|F32/i));
    if (candidates.length > 0) {
        return [...candidates].sort(bySize)[0];
    }

    return [...safe].sort(bySize)[0];
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
    // INTEGRITY, not mere existence: a partial/corrupt file at the target (app killed mid-download,
    // an HTML error page saved as .gguf) must NOT be promoted to "downloaded" — it would then crash
    // native initLlama at activation. Only skip the download when the file is a verified-intact GGUF
    // of the expected size; otherwise (re)download.
    const intact = await verifyModelFile(target, file.size);
    if (!intact) {
        options?.onStageChange?.('queued');
        try {
            options?.onStageChange?.('downloading');
            await downloadGgufModel(file.url, model.id, file.quantization, onProgress, { name: model.name, totalBytes: file.size });
            // Verify what actually landed before we register it as downloaded.
            if (!(await verifyModelFile(target, file.size))) {
                throw new Error('Nedladdningen blev ofullständig eller skadad. Försök igen.');
            }
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
