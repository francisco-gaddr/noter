import * as FileSystem from 'expo-file-system';
import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';
import { Platform } from 'react-native';

// Try to load RNFS safely
let RNFS: any;
try {
  RNFS = require("react-native-fs").default;
} catch (e) {
  RNFS = null;
}

export const MODELS_DIR = (RNFS?.DocumentDirectoryPath ? RNFS.DocumentDirectoryPath : '') + '/models/';

// Ensure models directory exists
export const ensureModelsDir = async () => {
    if (!RNFS?.DocumentDirectoryPath) return; // Skip if no FS access
    try {
        const exists = await RNFS.exists(MODELS_DIR);
        if (!exists) {
            await RNFS.mkdir(MODELS_DIR);
        }
    } catch (e) {
        console.warn("Failed to check/create models dir", e);
    }
};

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
    onProgress?: (percent: number) => void
): Promise<string> => {
    await ensureModelsDir();
    const destination = MODELS_DIR + file.filename.split('/').pop();

    const exists = await RNFS.exists(destination);
    if (exists) {
        return destination;
    }

    const download = RNFS.downloadFile({
        fromUrl: file.url,
        toFile: destination,
        background: true,
        discretionary: true,
        progress: (res) => {
            const percent = res.bytesWritten / res.contentLength;
            if (onProgress) onProgress(percent);
        }
    });

    try {
        const result = await download.promise;
        if (result.statusCode !== 200) throw new Error("Download failed");
        
        // Save metadata
        await saveModelLocal({
            id: uuidv4(),
            name: model.name,
            filename: file.filename,
            path: destination, // Use file path
            size: file.size,
            downloaded: true,
            quantization: file.quantization
        });
        
        return destination;
    } catch (error) {
        // Cleanup partial file
        await RNFS.unlink(destination).catch(() => {});
        throw error;
    }
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

export const cancelDownload = async (modelId: string) => {
    // RNFS download cancellation requires job ID. 
    // In this simple impl, we don't track job IDs globally exposed yet.
    // For now, no-op or implement job tracking map if needed.
    console.warn("Cancel download not fully implemented for RNFS");
};
