const mockGetInfo = jest.fn();
const mockMkdir = jest.fn();
const mockDelete = jest.fn();
const mockDownloadAsync = jest.fn();
const mockCreateResumable = jest.fn();

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

// The downloader migrated off react-native-fs (not new-arch compatible) to
// expo-file-system/legacy. Mock that surface: createDownloadResumable returns an
// object whose downloadAsync resolves the HTTP result.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  getInfoAsync: (path: string) => mockGetInfo(path),
  makeDirectoryAsync: (path: string, opts: any) => mockMkdir(path, opts),
  deleteAsync: (path: string, opts: any) => mockDelete(path, opts),
  createDownloadResumable: (...args: any[]) => mockCreateResumable(...args),
}));

// keep-awake is a best-effort no-op in tests.
jest.mock('../services/ai/keepAwake', () => ({
  acquireKeepAwake: () => () => {},
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
    mockGetInfo.mockReset();
    mockMkdir.mockReset();
    mockDelete.mockReset();
    mockDownloadAsync.mockReset();
    mockCreateResumable.mockReset();
    mockSaveModelLocal.mockReset();
    // createDownloadResumable returns a resumable whose downloadAsync resolves 200.
    mockDownloadAsync.mockResolvedValue({ status: 200 });
    mockCreateResumable.mockReturnValue({ downloadAsync: (...a: any[]) => mockDownloadAsync(...a) });
  });

  it('downloads a GGUF file directly to its target path and returns it', async () => {
    mockGetInfo.mockResolvedValue({ exists: true }); // base dir already there

    const result = await downloadGgufModel('https://hf.test/model.gguf', 'user/model', 'Q4_K_M');
    expect(result).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
    // No zip / no unzip step — a single .gguf file is the deliverable.
    const [url, target] = mockCreateResumable.mock.calls[0];
    expect(url).toBe('https://hf.test/model.gguf');
    expect(target).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
  });

  it('uses a BACKGROUND session so the transfer survives app suspension', async () => {
    mockGetInfo.mockResolvedValue({ exists: true });
    await downloadGgufModel('https://hf.test/model.gguf', 'user/model', 'Q4_K_M');
    const opts = mockCreateResumable.mock.calls[0][2];
    expect(opts.sessionType).toBe(0); // FileSystemSessionType.BACKGROUND
  });

  it('stores model metadata pointing at the GGUF path on download', async () => {
    mockGetInfo.mockResolvedValue({ exists: false }); // dir + target not present → download

    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any);
    expect(result).toBe(getModelPath('user/model', 'Q4_K_M'));
    expect(mockSaveModelLocal).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/llama_models/user_model-Q4_K_M.gguf', downloaded: true })
    );
  });
});
