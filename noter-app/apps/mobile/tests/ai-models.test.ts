const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockDownloadFile = jest.fn();

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

jest.mock('../services/database', () => ({
  saveModelLocal: jest.fn(),
  deleteModelLocal: jest.fn(),
}));

const mockSaveModelLocal = require('../services/database').saveModelLocal;

import { downloadGgufModel, getModelPath } from '../services/ai/ModelDownloader';
import { downloadModel } from '../services/ai/modelService';

describe('AI Models (GGUF-direct, llama.rn)', () => {
  beforeEach(() => {
    mockExists.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
    mockDownloadFile.mockReset();
    mockSaveModelLocal.mockReset();
  });

  it('downloads a GGUF file directly and returns its path', async () => {
    mockExists.mockResolvedValue(true); // base dir already there
    mockDownloadFile.mockReturnValue({ jobId: 1, promise: Promise.resolve({ statusCode: 200 }) });

    const result = await downloadGgufModel('https://hf.test/model.gguf', 'user/model', 'Q4_K_M');
    expect(result).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
    // No zip / no unzip step — a single .gguf file is the deliverable.
    const callArgs = mockDownloadFile.mock.calls[0][0];
    expect(callArgs.toFile).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
  });

  it('stores model metadata pointing at the GGUF path on download', async () => {
    mockExists.mockResolvedValue(false); // target not present → download
    mockDownloadFile.mockReturnValue({ jobId: 1, promise: Promise.resolve({ statusCode: 200 }) });

    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any);
    expect(result).toBe(getModelPath('user/model', 'Q4_K_M'));
    expect(mockSaveModelLocal).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/llama_models/user_model-Q4_K_M.gguf', downloaded: true })
    );
  });
});
