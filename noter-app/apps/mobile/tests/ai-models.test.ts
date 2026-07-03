const mockGetInfo = jest.fn();
const mockFreeDisk = jest.fn();
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
  EncodingType: { Base64: 'base64' },
  getInfoAsync: (path: string) => mockGetInfo(path),
  makeDirectoryAsync: (path: string, opts: any) => mockMkdir(path, opts),
  deleteAsync: (path: string, opts: any) => mockDelete(path, opts),
  createDownloadResumable: (...args: any[]) => mockCreateResumable(...args),
  // Post-download integrity check reads the GGUF magic + free disk space.
  readAsStringAsync: (..._a: any[]) => Promise.resolve('R0dVRg=='),
  getFreeDiskStorageAsync: () => mockFreeDisk(),
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
    mockFreeDisk.mockReset();
    mockFreeDisk.mockResolvedValue(512e9);
  });

  it('downloads a GGUF file directly to its target path and returns it', async () => {
    mockGetInfo.mockResolvedValue({ exists: true, size: 123 }); // base dir + downloaded file

    const result = await downloadGgufModel('https://hf.test/model.gguf', 'user/model', 'Q4_K_M');
    expect(result).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
    // No zip / no unzip step — a single .gguf file is the deliverable.
    const [url, target] = mockCreateResumable.mock.calls[0];
    expect(url).toBe('https://hf.test/model.gguf');
    expect(target).toBe('/docs/llama_models/user_model-Q4_K_M.gguf');
  });

  it('uses a BACKGROUND session so the transfer survives app suspension', async () => {
    mockGetInfo.mockResolvedValue({ exists: true, size: 123 });
    await downloadGgufModel('https://hf.test/model.gguf', 'user/model', 'Q4_K_M');
    const opts = mockCreateResumable.mock.calls[0][2];
    expect(opts.sessionType).toBe(0); // FileSystemSessionType.BACKGROUND
  });

  it('rejects a truncated download instead of reporting it as completed', async () => {
    // Server promised 1000 bytes but only 400 landed on disk (kill/drop mid-transfer).
    mockGetInfo.mockImplementation(async (path: string) =>
      path.endsWith('.gguf') ? { exists: true, size: 400 } : { exists: true });
    await expect(
      downloadGgufModel('https://hf.test/model.gguf', 'user/model-trunc', 'Q4_K_M', undefined, { totalBytes: 1000 }),
    ).rejects.toThrow(/verification/);
    // The corrupt partial must be cleaned up, not left as a "downloaded" model.
    expect(mockDelete).toHaveBeenCalledWith(
      expect.stringContaining('user_model-trunc'), expect.anything());
  });

  it('refuses to start a download that cannot fit on disk', async () => {
    mockGetInfo.mockResolvedValue({ exists: true, size: 123 });
    mockFreeDisk.mockResolvedValue(1e9); // 1 GB free, model needs 5 GB
    await expect(
      downloadGgufModel('https://hf.test/big.gguf', 'user/big-model', 'Q4_K_M', undefined, { totalBytes: 5e9 }),
    ).rejects.toThrow(/lagringsutrymme/);
    expect(mockCreateResumable).not.toHaveBeenCalled();
  });

  it('stores model metadata pointing at the GGUF path on download', async () => {
    // dir not present → created; the downloaded .gguf exists (with size) afterwards
    mockGetInfo.mockImplementation(async (path: string) =>
      path.endsWith('.gguf') ? { exists: true, size: 123 } : { exists: false });

    const model = { id: 'user/model', name: 'model', author: 'user', downloads: 0, likes: 0, tags: [] };
    const file = { filename: 'model.Q4_K_M.gguf', size: 123, url: 'https://hf.test', quantization: 'Q4_K_M' };
    const result = await downloadModel(model as any, file as any);
    expect(result).toBe(getModelPath('user/model', 'Q4_K_M'));
    expect(mockSaveModelLocal).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/llama_models/user_model-Q4_K_M.gguf', downloaded: true })
    );
  });
});
