import { act } from 'react-test-renderer';

const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockReadDir = jest.fn();
const mockReadFile = jest.fn();

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
    readDir: (...args: any[]) => mockReadDir(...args),
    readFile: (...args: any[]) => mockReadFile(...args),
  },
}));

describe('ModelDownloader security', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExists.mockReset();
    mockMkdir.mockReset();
    mockReadDir.mockReset();
    mockReadFile.mockReset();
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

  it('hittar faktisk paketrot när zip innehåller extra toppmapp', async () => {
    const { validateModelPackage } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/docs/mlc_models/user_model/Q4_K_M' ||
        path === '/docs/mlc_models/user_model/Q4_K_M/package/mlc-chat-config.json'
      )
    );
    mockReadDir.mockResolvedValue([
      {
        path: '/docs/mlc_models/user_model/Q4_K_M/package',
        isDirectory: () => true,
      },
      {
        path: '/docs/mlc_models/user_model/Q4_K_M/package/params_shard_0.bin',
        name: 'params_shard_0.bin',
        isDirectory: () => false,
      },
    ]);

    const result = await validateModelPackage('/docs/mlc_models/user_model/Q4_K_M');
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M/package');
  });

  it('avvisar paket som saknar parametrar eller refererade filer', async () => {
    const { validateModelPackage } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/docs/mlc_models/user_model/Q4_K_M/mlc-chat-config.json'
      )
    );
    mockReadDir.mockResolvedValue([]);
    mockReadFile.mockResolvedValue(JSON.stringify({ tokenizer_files: ['tokenizer.json'] }));

    await expect(validateModelPackage('/docs/mlc_models/user_model/Q4_K_M')).rejects.toThrow('Invalid model package');
  });

  it('hittar paketrot även när zipen är djupare kapslad', async () => {
    const { validateModelPackage } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/docs/mlc_models/user_model/Q4_K_M' ||
        path === '/docs/mlc_models/user_model/Q4_K_M/outer/inner/model/mlc-chat-config.json'
      )
    );
    mockReadDir.mockImplementation((path: string) => {
      if (path === '/docs/mlc_models/user_model/Q4_K_M') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/outer', name: 'outer', isDirectory: () => true }]);
      }
      if (path === '/docs/mlc_models/user_model/Q4_K_M/outer') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/outer/inner', name: 'inner', isDirectory: () => true }]);
      }
      if (path === '/docs/mlc_models/user_model/Q4_K_M/outer/inner') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/outer/inner/model', name: 'model', isDirectory: () => true }]);
      }
      if (path === '/docs/mlc_models/user_model/Q4_K_M/outer/inner/model') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/outer/inner/model/params_shard_0.bin', name: 'params_shard_0.bin', isDirectory: () => false }]);
      }
      return Promise.resolve([]);
    });

    const result = await validateModelPackage('/docs/mlc_models/user_model/Q4_K_M');
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M/outer/inner/model');
  });

  it('hittar paketrot även när modellen är djupare kapslad än tidigare sökdjup', async () => {
    const { validateModelPackage } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/docs/mlc_models/user_model/Q4_K_M'
        || path === '/docs/mlc_models/user_model/Q4_K_M/a/b/c/d/e/f/g/model/mlc-chat-config.json'
      )
    );
    mockReadDir.mockImplementation((path: string) => {
      if (path === '/docs/mlc_models/user_model/Q4_K_M') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/a', name: 'a', isDirectory: () => true }]);
      }
      if (path.endsWith('/a')) {
        return Promise.resolve([{ path: `${path}/b`, name: 'b', isDirectory: () => true }]);
      }
      if (path.endsWith('/b')) {
        return Promise.resolve([{ path: `${path}/c`, name: 'c', isDirectory: () => true }]);
      }
      if (path.endsWith('/c')) {
        return Promise.resolve([{ path: `${path}/d`, name: 'd', isDirectory: () => true }]);
      }
      if (path.endsWith('/d')) {
        return Promise.resolve([{ path: `${path}/e`, name: 'e', isDirectory: () => true }]);
      }
      if (path.endsWith('/e')) {
        return Promise.resolve([{ path: `${path}/f`, name: 'f', isDirectory: () => true }]);
      }
      if (path.endsWith('/f')) {
        return Promise.resolve([{ path: `${path}/g`, name: 'g', isDirectory: () => true }]);
      }
      if (path.endsWith('/g')) {
        return Promise.resolve([{ path: `${path}/model`, name: 'model', isDirectory: () => true }]);
      }
      if (path.endsWith('/model')) {
        return Promise.resolve([{ path: `${path}/params_shard_0.bin`, name: 'params_shard_0.bin', isDirectory: () => false }]);
      }
      return Promise.resolve([]);
    });

    const result = await validateModelPackage('/docs/mlc_models/user_model/Q4_K_M');
    expect(result).toBe('/docs/mlc_models/user_model/Q4_K_M/a/b/c/d/e/f/g/model');
  });

  it('godkänner refererade artefakter även med relativa path-segment', async () => {
    const { validateModelPackage } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/docs/mlc_models/user_model/Q4_K_M/mlc-chat-config.json'
      )
    );
    mockReadDir.mockResolvedValue([
      { path: '/docs/mlc_models/user_model/Q4_K_M/params', name: 'params', isDirectory: () => true },
      { path: '/docs/mlc_models/user_model/Q4_K_M/tokenizer', name: 'tokenizer', isDirectory: () => true },
    ]);
    mockReadDir.mockImplementation((path: string) => {
      if (path === '/docs/mlc_models/user_model/Q4_K_M') {
        return Promise.resolve([
          { path: '/docs/mlc_models/user_model/Q4_K_M/params', name: 'params', isDirectory: () => true },
          { path: '/docs/mlc_models/user_model/Q4_K_M/tokenizer', name: 'tokenizer', isDirectory: () => true },
        ]);
      }
      if (path === '/docs/mlc_models/user_model/Q4_K_M/params') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/params/params_shard_0.bin', name: 'params_shard_0.bin', isDirectory: () => false }]);
      }
      if (path === '/docs/mlc_models/user_model/Q4_K_M/tokenizer') {
        return Promise.resolve([{ path: '/docs/mlc_models/user_model/Q4_K_M/tokenizer/tokenizer.json', name: 'tokenizer.json', isDirectory: () => false }]);
      }
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue(JSON.stringify({
      params_shards: ['./params/params_shard_0.bin'],
      tokenizer_files: ['./tokenizer/./tokenizer.json'],
    }));

    await expect(validateModelPackage('/docs/mlc_models/user_model/Q4_K_M')).resolves.toBe('/docs/mlc_models/user_model/Q4_K_M');
  });

  it('försöker validera om modellpaketet några gånger innan fel kastas', async () => {
    jest.useFakeTimers();
    const { validateModelPackageWithRetry } = require('../services/ai/ModelDownloader');
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === '/docs/mlc_models/user_model/Q4_K_M/mlc-chat-config.json')
    );
    mockReadDir.mockResolvedValue([
      { path: '/docs/mlc_models/user_model/Q4_K_M/params_shard_0.bin', name: 'params_shard_0.bin', isDirectory: () => false },
    ]);
    mockReadFile
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(JSON.stringify({ params_shards: ['params_shard_0.bin'] }));

    const pending = validateModelPackageWithRetry('/docs/mlc_models/user_model/Q4_K_M', 2, 5);

    await act(async () => {
      jest.advanceTimersByTime(5);
      await Promise.resolve();
    });

    await expect(pending).resolves.toBe('/docs/mlc_models/user_model/Q4_K_M');
    jest.useRealTimers();
  });
});
