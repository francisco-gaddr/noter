const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDelete = jest.fn();
const mockActivateDataKey = jest.fn((key: string) => key);
const mockClearEncryptionKey = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: any[]) => mockGet(...args),
  setItemAsync: (...args: any[]) => mockSet(...args),
  deleteItemAsync: (...args: any[]) => mockDelete(...args),
}));

jest.mock('@repo/shared', () => ({
  activateDataKey: (key: string) => mockActivateDataKey(key),
  clearEncryptionKey: () => mockClearEncryptionKey(),
  unwrapDataKeyWithPassword: jest.fn(),
}));

describe('initLocalEncryptionKey', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDelete.mockReset();
    mockActivateDataKey.mockReset();
    mockActivateDataKey.mockImplementation((key: string) => key);
    mockClearEncryptionKey.mockReset();
  });

  it('returns empty string when no cached data key exists', async () => {
    mockGet.mockResolvedValue(null);
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe('');
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockActivateDataKey).not.toHaveBeenCalled();
    expect(mockClearEncryptionKey).toHaveBeenCalled();
  });

  it('ignores invalid legacy values', async () => {
    mockGet.mockResolvedValue('stored-key');
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe('');
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockActivateDataKey).not.toHaveBeenCalled();
  });

  it('reuses stored key when present', async () => {
    const storedKey = 'c'.repeat(64);
    mockGet.mockResolvedValue(storedKey);
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe(storedKey);
    expect(mockActivateDataKey).toHaveBeenCalledWith(storedKey);
    expect(mockSet).toHaveBeenCalledWith('local_data_key_v1', storedKey, expect.any(Object));
  });
});
