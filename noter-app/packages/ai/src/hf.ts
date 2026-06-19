export interface HFModel {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  tags: string[];
  /** ISO creation/release date (HF `createdAt`), when available. */
  createdAt?: string;
  /** ISO last-modified date (HF `lastModified`), when available. */
  lastModified?: string;
}

/** Sort key for the model browser: downloads, likes (≈ rating), or release date. */
export type HFModelSort = 'downloads' | 'likes' | 'recent';

/**
 * Pure, stable client-side sort so the UI can re-order an already-fetched result
 * set without a new network round-trip. Missing values sort last.
 */
export const sortModels = (models: HFModel[], sort: HFModelSort): HFModel[] => {
  // Drop non-objects / id-less entries so a malformed API row can't throw inside the
  // comparator (`b.likes` on null) and crash the whole model browser.
  const arr = (Array.isArray(models) ? models : []).filter(
    (m) => m && typeof m === 'object' && (m as any).id != null,
  );
  const time = (s?: string) => {
    const t = s ? new Date(s).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  switch (sort) {
    case 'likes':
      return arr.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    case 'recent':
      return arr.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    case 'downloads':
    default:
      return arr.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  }
};

export interface HFFile {
  filename: string;
  size: number;
  url: string;
  quantization?: string;
}

/** Bound an HF API call so a silent/slow upstream can't hang the proxy request
 *  handler forever (no DOMException dependency — works in Node and Hermes). */
const HF_FETCH_TIMEOUT_MS = 15_000;
export const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = HF_FETCH_TIMEOUT_MS): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export class HuggingFaceService {
  private baseUrl = 'https://huggingface.co/api';

  async searchModels(query: string): Promise<HFModel[]> {
    try {
      // Direct HF API Search for Mobile
      // Using full URL to avoid any proxy issues
      // full=true so the response carries createdAt/lastModified/likes for the
      // model browser's sort + detail view (not just downloads).
      const searchUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=30&full=true`;
      
      console.log('Searching HF:', searchUrl);

      const response = await fetchWithTimeout(searchUrl, {
          method: 'GET',
          headers: {
              'Accept': 'application/json',
              // Add simple user agent if needed
          }
      });

      if (!response.ok) {
          const text = await response.text();
          console.error('HF API Error:', response.status, text);
          throw new Error(`HF API Error: ${response.status} ${text}`);
      }

      const data = await response.json();
      
      return data.map((model: any) => ({
        id: model.id,
        author: model.author,
        name: model.id.split('/')[1] || model.id,
        downloads: model.downloads,
        likes: model.likes,
        tags: model.tags,
        createdAt: model.createdAt,
        lastModified: model.lastModified,
      }));
    } catch (error) {
      console.error('HF Search Error:', error);
      throw error; 
    }
  }

  async getModelFiles(modelId: string): Promise<HFFile[]> {
    try {
      const response = await fetchWithTimeout(`https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`);
      const data = await response.json();
      
      // Handle array or object response (HF API can vary)
      const files = Array.isArray(data) ? data : (data.tree || []);

      return files
        .filter((file: any) => file.path.endsWith('.gguf'))
        .map((file: any) => ({
          filename: file.path,
          size: file.size,
          url: `https://huggingface.co/${modelId}/resolve/main/${file.path}`,
          quantization: this.extractQuantization(file.path)
        }));
    } catch (error) {
      console.error('HF Files Error:', error);
      return [];
    }
  }

  private extractQuantization(filename: string): string | undefined {
    const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return (match && match[1]) ? match[1].toUpperCase() : undefined;
  }
}
