import { HFModel, HFFile } from '@repo/ai';
import { API_URL } from '@/services/api';

export const resolveWebBaseUrl = () => {
    const envUrl = process.env.EXPO_PUBLIC_WEB_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    const apiUrl = API_URL.replace(/\/$/, '');
    if (apiUrl.includes(':3001')) {
        return apiUrl.replace(':3001/api', ':3000/app');
    }
    return apiUrl.replace(/\/api$/, '/app');
};

const fetchJson = async (url: string) => {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
        }
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${text.substring(0, 100)}`);
    }
    return response.json();
};

export const searchHuggingFaceModels = async (query: string): Promise<HFModel[]> => {
    try {
        const webBase = resolveWebBaseUrl();
        const url = `${webBase}/api/ai/models/search?q=${encodeURIComponent(query)}`;
        console.log('[MobileHF] Searching (Web Proxy):', url);

        const data = await fetchJson(url);
        
        if (!Array.isArray(data)) throw new Error('Invalid response format from server');

        return data.map((model: any) => ({
            id: model.id,
            author: model.author,
            name: model.id.split('/')[1] || model.id,
            downloads: model.downloads,
            likes: model.likes,
            tags: model.tags
        }));

    } catch (error: any) {
        throw new Error(`Search failed: ${error.message}`);
    }
};


export const getModelFiles = async (modelId: string): Promise<HFFile[]> => {
    try {
        const webBase = resolveWebBaseUrl();
        const url = `${webBase}/api/ai/models/files?modelId=${encodeURIComponent(modelId)}`;
        console.log('[MobileHF] Fetching files (Web Proxy):', url);

        const files = await fetchJson(url);
        const normalized = files.map((file: any) => {
            const filename = file.filename || file.path;
            return {
                filename,
                size: file.size,
                url: file.url || `https://huggingface.co/${modelId}/resolve/main/${filename}`,
                quantization: file.quantization || extractQuantization(filename)
            };
        });

        return normalized.filter((file: any) => file.filename?.endsWith('.gguf'));
    } catch (error) {
        throw error;
    }
};

export const getCompiledModelUrl = async (params: {
    modelId: string;
    quantization?: string;
    platform: 'iphone' | 'android';
}): Promise<{ url: string; filename: string }> => {
    const webBase = resolveWebBaseUrl();
    const quant = (params.quantization || 'Q4_K_M').toUpperCase();
    const url = `${webBase}/api/ai/models/compiled?modelId=${encodeURIComponent(params.modelId)}&quant=${encodeURIComponent(quant)}&platform=${params.platform}`;
    const data = await fetchJson(url);
    if (!data?.url || !data?.filename) {
        throw new Error('Invalid compiled model response');
    }
    return { url: data.url, filename: data.filename };
};

export const requestModelConversion = async (params: {
    modelId: string;
    ggufUrl: string;
    quantization?: string;
    platform: 'iphone' | 'android';
}): Promise<{ jobId: string }> => {
    const webBase = resolveWebBaseUrl();
    const quant = (params.quantization || 'Q4_K_M').toUpperCase();
    const res = await fetch(`${webBase}/api/ai/models/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            modelId: params.modelId,
            ggufUrl: params.ggufUrl,
            quant: quant,
            platform: params.platform
        })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text.substring(0, 100)}`);
    }
    const data = await res.json();
    if (!data?.jobId) throw new Error('Invalid conversion response');
    return { jobId: data.jobId };
};

export const getConversionStatus = async (jobId: string): Promise<{
    status: 'queued' | 'downloading' | 'converting' | 'zipping' | 'completed' | 'failed';
    progress?: number;
    outputUrl?: string;
    message?: string;
}> => {
    const webBase = resolveWebBaseUrl();
    const url = `${webBase}/api/ai/models/convert?jobId=${encodeURIComponent(jobId)}`;
    return fetchJson(url);
};

export const getConversionHealth = async (): Promise<{
    mode: 'external' | 'local';
    externalEndpoint?: string;
    localBinary?: string;
    resolvedCommand?: string;
    localBinarySource?: string;
    localBinaryAvailable: boolean;
    installHint?: string;
    storageDir: string;
    storageWritable: boolean;
}> => {
    const webBase = resolveWebBaseUrl();
    const url = `${webBase}/api/ai/models/health`;
    return fetchJson(url);
};

const extractQuantization = (filename: string): string | undefined => {
    const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return (match && match[1]) ? match[1].toUpperCase() : undefined;
};
