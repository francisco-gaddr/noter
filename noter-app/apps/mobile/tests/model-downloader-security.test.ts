const mockExists = jest.fn();
const mockMkdir = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../utils/runtime', () => ({
  isExpoGo: () => false,
}));

jest.mock('react-native-fs', () => ({
  default: {
    DocumentDirectoryPath: '/docs',
    exists: (...args: any[]) => mockExists(...args),
    mkdir: (...args: any[]) => mockMkdir(...args),
  },
}));

describe('ModelDownloader security', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExists.mockReset();
    mockMkdir.mockReset();
  });

  it('sanitiserar modelId och quantization i model path', () => {
    const { getModelDir } = require('../services/ai/ModelDownloader');
    const modelDir = getModelDir('user/model:unsafe', 'q4_k_m../');
    expect(modelDir).toBe('/docs/mlc_models/user_model_unsafe/Q4_K_M.._');
  });

  it('skapar model-baskatalog när den saknas', async () => {
    const { ensureModelsDir } = require('../services/ai/ModelDownloader');
    mockExists.mockResolvedValue(false);
    await ensureModelsDir();
    expect(mockMkdir).toHaveBeenCalledWith('/docs/mlc_models');
  });
});
