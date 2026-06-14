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

const extractQuantization = (filename: string): string | undefined => {
    const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return (match && match[1]) ? match[1].toUpperCase() : undefined;
};
