export interface HFModel {
  id: string;
  author: string;
  name: string;
  downloads: number;
  tags: string[];
  files: HFFile[];
}

export interface HFFile {
  filename: string;
  size: number;
  url: string;
  quantization?: string;
}

export class HuggingFaceService {
  async searchModels(query: string): Promise<HFModel[]> {
    try {
      const response = await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&limit=20`);
      if (!response.ok) throw new Error('HF API error');
      const data = await response.json();
      return data.map((m: any) => ({
        id: m.modelId,
        author: m.author,
        name: m.modelId.split('/')[1] || m.modelId,
        downloads: m.downloads,
        tags: m.tags,
        files: []
      }));
    } catch (error) {
      console.error('HF Search Error:', error);
      return [];
    }
  }

  async getModelFiles(modelId: string): Promise<HFFile[]> {
    try {
      const response = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`);
      if (!response.ok) throw new Error('HF Tree API error');
      const data = await response.json();
      return data
        .filter((f: any) => f.path.endsWith('.gguf'))
        .map((f: any) => ({
          filename: f.path,
          size: f.size,
          url: `https://huggingface.co/${modelId}/resolve/main/${f.path}`,
          quantization: this.extractQuantization(f.path)
        }));
    } catch (error) {
      console.error('HF Files Error:', error);
      return [];
    }
  }

  private extractQuantization(filename: string): string | undefined {
    // Regex for common quantization patterns like Q4_K_M, Q5_0, etc.
    const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return (match && match[1]) ? match[1].toUpperCase() : undefined;
  }
}
