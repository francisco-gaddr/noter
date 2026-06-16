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

const fetchJson = async (url: string): Promise<unknown> => {
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (e: any) {
        // Network failure (offline, DNS, TLS) — surface a clean, readable error.
        throw new Error(`Nätverksfel: ${e?.message || 'kunde inte nå servern'}`);
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${text.substring(0, 100)}`);
    }
    // Guard malformed/non-JSON bodies (HTML error page, truncated stream) — response.json()
    // throws a SyntaxError otherwise, which previously bubbled up as an uncaught rejection.
    try {
        return await response.json();
    } catch {
        throw new Error('Servern svarade med ogiltigt format (inte JSON).');
    }
};

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const searchHuggingFaceModels = async (query: string): Promise<HFModel[]> => {
    try {
        const webBase = resolveWebBaseUrl();
        const url = `${webBase}/api/ai/models/search?q=${encodeURIComponent(query)}`;
        console.log('[MobileHF] Searching (Web Proxy):', url);

        const data = await fetchJson(url);

        if (!Array.isArray(data)) throw new Error('Ogiltigt svarsformat från servern.');

        // Build defensively: a single malformed entry must never break the whole list.
        return data.reduce<HFModel[]>((acc, model: any) => {
            const id = asString(model?.id);
            if (!id) return acc; // an entry without an id is unusable — skip it
            acc.push({
                id,
                author: asString(model?.author) || (id.includes('/') ? id.split('/')[0] : ''),
                name: id.includes('/') ? (id.split('/')[1] || id) : id,
                downloads: asNumber(model?.downloads) ?? 0,
                likes: asNumber(model?.likes) ?? 0,
                tags: Array.isArray(model?.tags) ? model.tags.filter((t: any) => typeof t === 'string') : [],
                createdAt: asString(model?.createdAt),
                lastModified: asString(model?.lastModified),
            });
            return acc;
        }, []);

    } catch (error: any) {
        throw new Error(`Sökningen misslyckades: ${error?.message || 'okänt fel'}`);
    }
};


export const getModelFiles = async (modelId: string): Promise<HFFile[]> => {
    const webBase = resolveWebBaseUrl();
    const url = `${webBase}/api/ai/models/files?modelId=${encodeURIComponent(modelId)}`;
    console.log('[MobileHF] Fetching files (Web Proxy):', url);

    const files = await fetchJson(url);
    // The proxy can return a non-array (e.g. {error: ...}) on failure — never .map() blindly.
    if (!Array.isArray(files)) return [];

    return files.reduce<HFFile[]>((acc, file: any) => {
        const filename = asString(file?.filename) || asString(file?.path);
        if (!filename || !/\.gguf$/i.test(filename)) return acc; // only real GGUF files
        acc.push({
            filename,
            size: asNumber(file?.size) ?? 0,
            url: asString(file?.url) || `https://huggingface.co/${modelId}/resolve/main/${filename}`,
            quantization: asString(file?.quantization) || extractQuantization(filename),
        });
        return acc;
    }, []);
};

const extractQuantization = (filename: unknown): string | undefined => {
    if (typeof filename !== 'string') return undefined;
    const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return (match && match[1]) ? match[1].toUpperCase() : undefined;
};
