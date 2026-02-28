export interface HFModel {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  tags: string[];
}

export interface HFFile {
  filename: string;
  size: number;
  url: string;
  quantization?: string;
}

export class HuggingFaceService {
  private baseUrl = 'https://huggingface.co/api';

  async searchModels(query: string): Promise<HFModel[]> {
    try {
      // Direct HF API Search for Mobile
      // Using full URL to avoid any proxy issues
      const searchUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=20`;
      
      console.log('Searching HF:', searchUrl);
      
      const response = await fetch(searchUrl, {
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
        tags: model.tags
      }));
    } catch (error) {
      console.error('HF Search Error:', error);
      throw error; 
    }
  }

  async getModelFiles(modelId: string): Promise<HFFile[]> {
    try {
      const response = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`);
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
