const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockReadDir = jest.fn();
const mockDownloadPromise = jest.fn();
const mockDownloadFile = jest.fn();
const mockUnzip = jest.fn();
const mockConvertGGUFToMLC = jest.fn();
const mockGetLocalConversionCapabilities = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: (path: string) => mockExists(path),
  mkdir: (path: string) => mockMkdir(path),
  unlink: (path: string) => mockUnlink(path),
    readDir: (path: string) => mockReadDir(path),
  downloadFile: (...args: any[]) => mockDownloadFile(...args),
  default: {
    DocumentDirectoryPath: '/docs',
    exists: (path: string) => mockExists(path),
    mkdir: (path: string) => mockMkdir(path),
    unlink: (path: string) => mockUnlink(path),
    downloadFile: (...args: any[]) => mockDownloadFile(...args),
    readDir: (path: string) => mockReadDir(path),
  },
}));


jest.mock('react-native-zip-archive', () => ({
  unzip: (...args: any[]) => mockUnzip(...args),
  default: {
    unzip: (...args: any[]) => mockUnzip(...args),
  },
}));

jest.mock('../utils/runtime', () => ({
  isExpoGo: () => false,
}));

jest.mock('../services/ai/native/MLCModule', () => ({
  convertGGUFToMLC: (...args: any[]) => mockConvertGGUFToMLC(...args),
  getLocalConversionCapabilities: (...args: any[]) => mockGetLocalConversionCapabilities(...args),
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
  validateModelPackage: jest.fn(async (path: string) => path),
}));

describe('AI Models', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExists.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
    mockReadDir.mockReset();
    mockDownloadPromise.mockReset();
    mockDownloadFile.mockReset();
    mockUnzip.mockReset();
    mockConvertGGUFToMLC.mockReset();
    mockGetLocalConversionCapabilities.mockReset();
  });

  it('downloads compiled model package and returns model directory', async () => {
    const { downloadCompiledModel } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('mlc-chat-config.json')));
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockUnzip.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M');

    const result = await downloadCompiledModel('https://models.test/compiled.zip', 'user/model', 'Q4_K_M');
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
  });

  it('stores compiled model metadata on download', async () => {
    const { getModelDir } = require('../services/ai/ModelDownloader');
    const { downloadModel } = require('../services/ai/modelService');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any);
    expect(result).toBe(getModelDir('user/model', 'Q4_K_M'));
  });

  it('uses local conversion when device capabilities are available', async () => {
    const { downloadModel } = require('../services/ai/modelService');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' };

    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('mlc-chat-config.json')));
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockGetLocalConversionCapabilities.mockResolvedValue({ engineAvailable: true, converterAvailable: true });
    mockConvertGGUFToMLC.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M');

    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true });

    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
    expect(mockConvertGGUFToMLC).toHaveBeenCalled();
  });
});
