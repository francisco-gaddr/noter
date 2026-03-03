const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockDownloadPromise = jest.fn();
const mockDownloadFile = jest.fn();
const mockUnzip = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

jest.mock('react-native-fs', () => ({
  default: {
    DocumentDirectoryPath: '/docs',
    exists: (path: string) => mockExists(path),
    mkdir: (path: string) => mockMkdir(path),
    unlink: (path: string) => mockUnlink(path),
    downloadFile: (...args: any[]) => mockDownloadFile(...args),
  },
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: (...args: any[]) => mockUnzip(...args),
}));

jest.mock('../services/database', () => ({
  saveModelLocal: jest.fn(),
  deleteModelLocal: jest.fn(),
}));

jest.mock('../services/ai/huggingface', () => ({
  requestModelConversion: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  getConversionStatus: jest.fn().mockResolvedValue({ status: 'completed', progress: 1, outputUrl: 'https://models.test/compiled.zip' }),
  getCompiledModelUrl: jest.fn().mockResolvedValue({ url: 'https://models.test/compiled.zip', filename: 'Q4_K_M.zip' }),
}));

jest.mock('../services/ai/ModelDownloader', () => ({
  downloadCompiledModel: jest.fn().mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M'),
  getModelDir: jest.fn().mockReturnValue('/docs/mlc_models/user_model/Q4_K_M'),
  getPlatformTarget: jest.fn().mockReturnValue('iphone'),
}));

import { downloadCompiledModel, getModelDir } from '../services/ai/ModelDownloader';
import { downloadModel } from '../services/ai/modelService';

describe('AI Models', () => {
  beforeEach(() => {
    mockExists.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
    mockDownloadPromise.mockReset();
    mockDownloadFile.mockReset();
    mockUnzip.mockReset();
  });

  it('downloads compiled model package and returns model directory', async () => {
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('mlc-chat-config.json')));
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockUnzip.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M');

    const result = await downloadCompiledModel('https://models.test/compiled.zip', 'user/model', 'Q4_K_M');
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
  });

  it('stores compiled model metadata on download', async () => {
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any);
    expect(result).toBe(getModelDir('user/model', 'Q4_K_M'));
  });
});
