const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockReadDir = jest.fn();
const mockDownloadPromise = jest.fn();
const mockDownloadFile = jest.fn();
const mockStopDownload = jest.fn();
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
  stopDownload: (...args: any[]) => mockStopDownload(...args),
  default: {
    DocumentDirectoryPath: '/docs',
    exists: (path: string) => mockExists(path),
    mkdir: (path: string) => mockMkdir(path),
    unlink: (path: string) => mockUnlink(path),
    downloadFile: (...args: any[]) => mockDownloadFile(...args),
    readDir: (path: string) => mockReadDir(path),
    stopDownload: (...args: any[]) => mockStopDownload(...args),
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
  getCompiledModelUrl: jest.fn().mockResolvedValue({ url: 'https://models.test/compiled.zip', filename: 'Q4_K_M.zip', available: false }),
}));

jest.mock('../services/ai/ModelDownloader', () => ({
  downloadCompiledModel: jest.fn().mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M'),
  getModelDir: jest.fn().mockReturnValue('/docs/mlc_models/user_model/Q4_K_M'),
  getPlatformTarget: jest.fn().mockReturnValue('iphone'),
  validateModelPackage: jest.fn(async (path: string) => path),
  validateModelPackageWithRetry: jest.fn(async (path: string) => path),
}));

jest.mock('../services/ai/installSession', () => ({
  getModelInstallSessionKey: jest.fn((modelId: string, quantization?: string) => `${modelId}::${(quantization || 'Q4_K_M').toUpperCase()}`),
  listModelInstallSessions: jest.fn().mockResolvedValue([]),
  patchModelInstallSession: jest.fn().mockResolvedValue(undefined),
  removeModelInstallSession: jest.fn().mockResolvedValue(undefined),
  upsertModelInstallSession: jest.fn().mockResolvedValue(undefined),
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
    mockStopDownload.mockReset();
    mockUnzip.mockReset();
    mockConvertGGUFToMLC.mockReset();
    mockGetLocalConversionCapabilities.mockReset();
    mockGetLocalConversionCapabilities.mockResolvedValue({ engineAvailable: false, converterAvailable: false });
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
    const { saveModelLocal } = require('../services/database');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true });
    expect(result).toBe(getModelDir('user/model', 'Q4_K_M'));
    expect(saveModelLocal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'model_user_model_Q4_K_M',
      path: '/docs/mlc_models/user_model/Q4_K_M',
    }));
  });

  it('uses local conversion only for strict device checks', async () => {
    const { downloadModel } = require('../services/ai/modelService');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' };

    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('mlc-chat-config.json')));
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockGetLocalConversionCapabilities.mockResolvedValue({ engineAvailable: true, converterAvailable: true });
    mockConvertGGUFToMLC.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M');

    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true, strictLocalConversion: true });

    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
    expect(mockConvertGGUFToMLC).toHaveBeenCalled();
  });

  it('starts automatic conversion when compiled package is missing', async () => {
    const { downloadModel } = require('../services/ai/modelService');
    const { requestModelConversion, getCompiledModelUrl } = require('../services/ai/huggingface');
    const downloader = require('../services/ai/ModelDownloader');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' };

    mockExists.mockResolvedValue(false);
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockGetLocalConversionCapabilities.mockResolvedValue({ engineAvailable: true, converterAvailable: true });
    mockConvertGGUFToMLC.mockRejectedValue(new Error('Local conversion failed'));
    downloader.validateModelPackageWithRetry.mockRejectedValueOnce(new Error('Invalid model package'));

    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true });

    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
    expect(getCompiledModelUrl).toHaveBeenCalled();
    expect(requestModelConversion).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'user/model',
      ggufUrl: 'https://hf.test/model.gguf',
      quantization: 'Q4_K_M',
    }));
    expect(mockConvertGGUFToMLC).not.toHaveBeenCalled();
  });

  it('downloads precompiled package directly when already available', async () => {
    const { downloadModel } = require('../services/ai/modelService');
    const { getCompiledModelUrl, requestModelConversion } = require('../services/ai/huggingface');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' };

    mockExists.mockResolvedValue(false);
    getCompiledModelUrl.mockResolvedValue({ url: 'https://models.test/compiled.zip', filename: 'Q4_K_M.zip', available: true });

    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true });

    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M');
    expect(requestModelConversion).not.toHaveBeenCalled();
  });

  it('faller tillbaka till lokal konvertering när compiled-paketet inte kan valideras', async () => {
    const downloader = require('../services/ai/ModelDownloader');
    const { downloadModel } = require('../services/ai/modelService');
    const { getCompiledModelUrl } = require('../services/ai/huggingface');
    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' };

    mockExists.mockResolvedValue(false);
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve({ statusCode: 200 }) });
    mockGetLocalConversionCapabilities.mockResolvedValue({ engineAvailable: true, converterAvailable: true });
    mockConvertGGUFToMLC.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M/local');
    getCompiledModelUrl.mockResolvedValue({ url: 'https://models.test/compiled.zip', filename: 'Q4_K_M.zip', available: true });
    downloader.validateModelPackageWithRetry.mockRejectedValueOnce(new Error('Invalid model package'));
    downloader.downloadCompiledModel.mockRejectedValueOnce(new Error('Invalid model package: package root not found'));
    downloader.validateModelPackageWithRetry.mockImplementation(async (path: string) => path);

    const result = await downloadModel(model as any, file as any, undefined, { preferLocalConversion: true });

    expect(mockConvertGGUFToMLC).toHaveBeenCalled();
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M/local');
  });

  it('resumes pending install sessions after background interruption', async () => {
    const { resumePendingModelDownloads } = require('../services/ai/modelService');
    const installSession = require('../services/ai/installSession');
    const completed = jest.fn();
    installSession.listModelInstallSessions.mockResolvedValue([
      {
        key: 'user/model::Q4_K_M',
        model: { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] },
        file: { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' },
        preferLocalConversion: false,
        strictLocalConversion: false,
        stage: 'converting_server',
        progress: 0.4,
        platform: 'iphone',
        jobId: 'job-1',
        updatedAt: new Date().toISOString(),
      },
    ]);
    mockExists.mockResolvedValue(false);

    await resumePendingModelDownloads({ onCompleted: completed });

    expect(completed).toHaveBeenCalledWith('user/model', '/docs/mlc_models/user_model/Q4_K_M');
  });

  it('cancels active downloads and marks sessions as cancelled', async () => {
    const { cancelDownload } = require('../services/ai/modelService');
    const installSession = require('../services/ai/installSession');

    installSession.listModelInstallSessions.mockResolvedValue([
      {
        key: 'user/model::Q4_K_M',
        model: { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] },
        file: { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test/model.gguf', quantization: 'Q4_K_M' },
        stage: 'downloading_gguf',
        progress: 0.3,
        jobId: 42,
      },
    ]);

    await cancelDownload('user/model');

    expect(mockStopDownload).toHaveBeenCalledWith(42);
    expect(installSession.patchModelInstallSession).toHaveBeenCalledWith('user/model::Q4_K_M', expect.objectContaining({
      stage: 'cancelled',
      progress: 0,
    }));
  });

  it('persists normalized model path when package root changes', async () => {
    const { normalizeStoredModelRecord } = require('../services/ai/modelService');
    const { saveModelLocal } = require('../services/database');
    const { validateModelPackageWithRetry } = require('../services/ai/ModelDownloader');
    validateModelPackageWithRetry.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M/model');

    const normalized = await normalizeStoredModelRecord({
      id: 'model_user_model_Q4_K_M',
      name: 'model',
      filename: 'Q4_K_M.zip',
      path: '/docs/mlc_models/user_model/Q4_K_M',
      size: 123,
      quantization: 'Q4_K_M',
      downloaded: true,
    });

    expect(normalized.path).toBe('/docs/mlc_models/user_model/Q4_K_M/model');
    expect(saveModelLocal).toHaveBeenCalledWith(expect.objectContaining({
      path: '/docs/mlc_models/user_model/Q4_K_M/model',
    }));
  });

  it('does not rewrite model metadata when stored package path is already normalized', async () => {
    const { normalizeStoredModelRecord } = require('../services/ai/modelService');
    const { saveModelLocal } = require('../services/database');
    const { validateModelPackageWithRetry } = require('../services/ai/ModelDownloader');
    validateModelPackageWithRetry.mockResolvedValue('/docs/mlc_models/user_model/Q4_K_M');

    const normalized = await normalizeStoredModelRecord({
      id: 'model_user_model_Q4_K_M',
      name: 'model',
      filename: 'Q4_K_M.zip',
      path: '/docs/mlc_models/user_model/Q4_K_M',
      size: 123,
      quantization: 'Q4_K_M',
      downloaded: true,
    });

    expect(normalized.path).toBe('/docs/mlc_models/user_model/Q4_K_M');
    expect(saveModelLocal).not.toHaveBeenCalled();
  });

  it('creates stable installed model ids per model and quantization', async () => {
    const { getInstalledModelRecordId } = require('../services/ai/modelService');

    expect(getInstalledModelRecordId('user/model', 'Q4_K_M')).toBe('model_user_model_Q4_K_M');
    expect(getInstalledModelRecordId('user/model', 'q5_k_m')).toBe('model_user_model_Q5_K_M');
  });
});
