const mockGet = jest.fn();
const mockSet = jest.fn();
const mockSetEncryptionKey = jest.fn();
const mockGetRandomBytesAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: any[]) => mockGet(...args),
  setItemAsync: (...args: any[]) => mockSet(...args),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: (...args: any[]) => mockGetRandomBytesAsync(...args),
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
    mockGetRandomBytesAsync.mockReset();
    mockGetRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(1));
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

  it('reuses legacy stored key without rotating', async () => {
    mockGet.mockResolvedValue('stored-key');
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe('stored-key');
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockSetEncryptionKey).toHaveBeenCalledWith('stored-key');
  });

  it('reuses stored key when present', async () => {
    const storedKey = 'c'.repeat(64);
    mockGet.mockResolvedValue(storedKey);
    const { initLocalEncryptionKey } = require('../services/encryptionKey');
    const key = await initLocalEncryptionKey();
    expect(key).toBe(storedKey);
    expect(mockSetEncryptionKey).toHaveBeenCalledWith(storedKey);
  });
});
