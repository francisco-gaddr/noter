const mockGet = jest.fn();
const mockSet = jest.fn();
const mockSetEncryptionKey = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: any[]) => mockGet(...args),
  setItemAsync: (...args: any[]) => mockSet(...args),
}));

jest.mock('@repo/shared', () => ({
  setEncryptionKey: (...args: any[]) => mockSetEncryptionKey(...args),
}));

describe('initLocalEncryptionKey', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockSetEncryptionKey.mockReset();
  });

  it('creates and stores key when missing', async () => {
    mockGet.mockResolvedValue(null);
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBe(64);
    expect(mockSet).toHaveBeenCalled();
    expect(mockSetEncryptionKey).toHaveBeenCalledWith(key);
  });

  it('reuses stored key when present', async () => {
    mockGet.mockResolvedValue('stored-key');
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe('stored-key');
    expect(mockSetEncryptionKey).toHaveBeenCalledWith('stored-key');
  });
});
