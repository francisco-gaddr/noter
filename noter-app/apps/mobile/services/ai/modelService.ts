import * as FileSystem from 'expo-file-system/legacy';
import { HFFile, HFModel } from '@repo/ai';
import { saveModelLocal, deleteModelLocal } from '@/services/database';
import { v4 as uuidv4 } from 'uuid';

export const MODELS_DIR = FileSystem.documentDirectory + 'models/';
const activeDownloads = new Map<string, { resumable: FileSystem.DownloadResumable; destination: string }>();

// Ensure models directory exists
export const ensureModelsDir = async () => {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
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

    // Check if already exists
    const fileInfo = await FileSystem.getInfoAsync(destination);
    if (fileInfo.exists) {
        // Already downloaded, just register it if needed or return path
        return destination;
    }

    const downloadResumable = FileSystem.createDownloadResumable(
        file.url,
        destination,
        {},
        (progress) => {
            const percent = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
            if (onProgress) onProgress(percent);
        }
    );

    try {
        activeDownloads.set(model.id, { resumable: downloadResumable, destination });
        const result = await downloadResumable.downloadAsync();
        if (!result?.uri) throw new Error("Download failed");
        
        // Save metadata
        await saveModelLocal({
            id: uuidv4(),
            name: model.name,
            filename: file.filename,
            path: result.uri,
            size: file.size,
            downloaded: true,
            quantization: file.quantization
        });
        
        return result.uri;
    } catch (error) {
        // Cleanup partial file
        await FileSystem.deleteAsync(destination, { idempotent: true });
        throw error;
    } finally {
        activeDownloads.delete(model.id);
    }
};

export const deleteModel = async (id: string, path: string) => {
    try {
        await FileSystem.deleteAsync(path, { idempotent: true });
        await deleteModelLocal(id);
    } catch (error) {
        console.error("Failed to delete model file:", error);
        // Still delete from DB if file is gone or error
        await deleteModelLocal(id);
    }
};

export const cancelDownload = async (modelId: string) => {
    const active = activeDownloads.get(modelId);
    if (!active) return;
    try {
        await active.resumable.pauseAsync();
    } catch {}
    await FileSystem.deleteAsync(active.destination, { idempotent: true });
    activeDownloads.delete(modelId);
};
