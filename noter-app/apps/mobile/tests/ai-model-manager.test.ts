const mockExists = jest.fn();
const mockLoadModel = jest.fn();
const mockUnloadModel = jest.fn();
const mockValidateModelPackage = jest.fn(async (path: string) => path);
const mockDownloadCompiledModel = jest.fn(async (url: string, _modelId?: string, _quantization?: string) => url);

jest.mock('react-native-fs', () => ({
  default: {
    exists: (...args: any[]) => mockExists(...args),
  },
}));

jest.mock('../services/ai/native/MLCModule', () => ({
  loadModel: (...args: any[]) => mockLoadModel(...args),
  unloadModel: (...args: any[]) => mockUnloadModel(...args),
}));

jest.mock('../services/ai/ModelDownloader', () => ({
  downloadCompiledModel: (url: string, modelId: string, quantization?: string) =>
    mockDownloadCompiledModel(url, modelId, quantization),
  validateModelPackage: (path: string) => mockValidateModelPackage(path),
}));

describe('ModelManager', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExists.mockReset();
    mockLoadModel.mockReset();
    mockUnloadModel.mockReset();
    mockValidateModelPackage.mockReset();
    mockDownloadCompiledModel.mockReset();
    mockValidateModelPackage.mockImplementation(async (path: string) => path);
    mockDownloadCompiledModel.mockImplementation(async (url: string) => url);
    mockExists.mockResolvedValue(true);
    mockLoadModel.mockResolvedValue(undefined);
    mockUnloadModel.mockResolvedValue(undefined);
  });

  it('unloads previous model before switching to a new validated path', async () => {
    const { modelManager } = require('../services/ai/ModelManager');

    await modelManager.load('/docs/model-a');
    await modelManager.load('/docs/model-b');

    expect(mockUnloadModel).toHaveBeenCalledTimes(1);
    expect(mockLoadModel).toHaveBeenNthCalledWith(1, '/docs/model-a');
    expect(mockLoadModel).toHaveBeenNthCalledWith(2, '/docs/model-b');
  });

  it('does not reload the same normalized model twice', async () => {
    const { modelManager } = require('../services/ai/ModelManager');
    mockValidateModelPackage.mockResolvedValue('/docs/model-a/package');

    await modelManager.load('/docs/model-a');
    await modelManager.load('/docs/model-a/package');

    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    expect(mockUnloadModel).not.toHaveBeenCalled();
  });

  it('normaliserar installerad modell före load och återanvänder redan laddad modell', async () => {
    const { modelManager } = require('../services/ai/ModelManager');
    mockDownloadCompiledModel.mockResolvedValue('/docs/raw-download');
    mockValidateModelPackage.mockResolvedValue('/docs/normalized-model');

    await modelManager.install({ url: 'https://models.test/model.zip', modelId: 'user/model', quantization: 'Q4_K_M' });
    await modelManager.load('/docs/normalized-model');

    expect(mockDownloadCompiledModel).toHaveBeenCalledWith('https://models.test/model.zip', 'user/model', 'Q4_K_M');
    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    expect(mockLoadModel).toHaveBeenCalledWith('/docs/normalized-model');
    expect(mockUnloadModel).not.toHaveBeenCalled();
  });

  it('skippar unload när ingen modell är laddad', async () => {
    const { modelManager } = require('../services/ai/ModelManager');

    await modelManager.unload();

    expect(mockUnloadModel).not.toHaveBeenCalled();
  });
});
