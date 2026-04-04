const mockLoad = jest.fn();
const mockUnload = jest.fn();
const mockChat = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

jest.mock('../utils/runtime', () => ({
  isExpoGo: () => false,
}));

jest.mock('../services/ai/ModelManager', () => ({
  modelManager: {
    load: (...args: any[]) => mockLoad(...args),
    unload: (...args: any[]) => mockUnload(...args),
    chat: (...args: any[]) => mockChat(...args),
  },
}));

jest.mock('../services/database', () => ({
  saveModelLocal: jest.fn(),
  deleteModelLocal: jest.fn(),
}));

jest.mock('../services/ai/ModelDownloader', () => ({
  downloadCompiledModel: jest.fn().mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M'),
  getModelDir: jest.fn().mockReturnValue('/docs/mlc_models/user_model/Q4_K_M'),
  getPlatformTarget: jest.fn().mockReturnValue('iphone'),
  validateModelPackage: jest.fn(async (path: string) => path),
  validateModelPackageWithRetry: jest.fn(async (path: string) => path),
}));

jest.mock('../services/ai/huggingface', () => ({
  requestModelConversion: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  getConversionStatus: jest.fn().mockResolvedValue({ status: 'completed', progress: 1, outputUrl: 'https://models.test/compiled.zip' }),
  getCompiledModelUrl: jest.fn().mockResolvedValue({ url: 'https://models.test/compiled.zip', filename: 'Q4_K_M.zip', available: false }),
}));

jest.mock('../services/ai/installSession', () => ({
  getModelInstallSessionKey: jest.fn((modelId: string, quantization?: string) => `${modelId}::${(quantization || 'Q4_K_M').toUpperCase()}`),
  listModelInstallSessions: jest.fn().mockResolvedValue([]),
  patchModelInstallSession: jest.fn().mockResolvedValue(undefined),
  removeModelInstallSession: jest.fn().mockResolvedValue(undefined),
  upsertModelInstallSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/ai/native/MLCModule', () => ({
  convertGGUFToMLC: jest.fn(),
  getLocalConversionCapabilities: jest.fn().mockResolvedValue({ engineAvailable: false, converterAvailable: false }),
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn().mockResolvedValue(true),
  unlink: jest.fn(),
  default: {
    DocumentDirectoryPath: '/docs',
    exists: jest.fn().mockResolvedValue(true),
    unlink: jest.fn(),
  },
}));

import { MobileLlamaProvider } from '../services/ai/provider';
import { downloadModel } from '../services/ai/modelService';

describe('AI E2E', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockUnload.mockReset();
    mockChat.mockReset();
  });

  it('downloads, loads and chats with a model', async () => {
    mockChat.mockResolvedValue('Svar');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const path = await downloadModel(model as any, file as any);
    const provider = new MobileLlamaProvider();
    await provider.loadModel(path);
    const response = await provider.generateResponse([
      { id: 's1', role: 'system', content: 'System', createdAt: new Date().toISOString() },
      { id: 'u1', role: 'user', content: 'Hej', createdAt: new Date().toISOString() },
    ]);
    expect(response).toBe('Svar');
    expect(mockLoad).toHaveBeenCalledWith(path);
  });
});
