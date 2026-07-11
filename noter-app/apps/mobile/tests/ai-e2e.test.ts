const mockLoad = jest.fn();
const mockUnload = jest.fn();
const mockComplete = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: (...args: any[]) => mockLoad(...args),
    unload: (...args: any[]) => mockUnload(...args),
    complete: (...args: any[]) => mockComplete(...args),
  },
}));

jest.mock('../services/database', () => ({
  saveModelLocal: jest.fn(),
  deleteModelLocal: jest.fn(),
}));

jest.mock('../services/ai/ModelDownloader', () => ({
  downloadGgufModel: jest.fn().mockResolvedValue('/docs/llama_models/user_model-Q4_K_M.gguf'),
  getModelPath: jest.fn().mockReturnValue('/docs/llama_models/user_model-Q4_K_M.gguf'),
  modelFileExists: jest.fn().mockResolvedValue(false),
  // downloadModel now gates on integrity: absent BEFORE the download (→ downloads), intact AFTER.
  verifyModelFile: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
  deleteModelFile: jest.fn(),
  stopModelDownload: jest.fn(),
}));

import { MobileLlamaProvider } from '../services/ai/provider';
import { downloadModel } from '../services/ai/modelService';

describe('AI E2E', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockUnload.mockReset();
    mockComplete.mockReset();
  });

  it('downloads (GGUF-direct), loads and chats with a model', async () => {
    mockComplete.mockResolvedValue('Svar');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const path = await downloadModel(model as any, file as any);
    expect(path).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
    const provider = new MobileLlamaProvider();
    await provider.loadModel(path);
    const response = await provider.generateResponse([
      { id: 's1', role: 'system', content: 'System', createdAt: new Date().toISOString() },
      { id: 'u1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
    ]);
    expect(response).toBe('Svar');
    // loadModel now forwards an optional onProgress arg (undefined here).
    expect(mockLoad).toHaveBeenCalledWith(path, undefined);
  });
});
