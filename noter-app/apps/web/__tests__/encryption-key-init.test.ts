const mockActivateDataKey = jest.fn((key: string) => key);
const mockClearEncryptionKey = jest.fn();

jest.mock('@repo/shared', () => ({
  activateDataKey: (key: string) => mockActivateDataKey(key),
  clearEncryptionKey: () => mockClearEncryptionKey(),
  unwrapDataKeyWithPassword: jest.fn(),
}));

describe('initWebEncryptionKey', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    mockActivateDataKey.mockReset();
    mockActivateDataKey.mockImplementation((key: string) => key);
    mockClearEncryptionKey.mockReset();
    (window as any).mlc = undefined;
  });

  it('does not invent a new key in plain web mode without cached key material', async () => {
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe('');
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
    expect(localStorage.getItem('local_data_key_v1')).toBeNull();
    expect(mockActivateDataKey).not.toHaveBeenCalled();
  });

  it('uses the cached electron data key when available', async () => {
    const secureKey = 'd'.repeat(64);
    const getSetting = jest.fn().mockImplementation(async (key: string) => (key === 'localDataKey' ? secureKey : ''));
    const setSetting = jest.fn().mockResolvedValue(true);
    (window as any).mlc = { isElectron: true, getSetting, setSetting };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe(secureKey);
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
  });

  it('migrates valid legacy localStorage key to electron secure storage', async () => {
    const legacyKey = 'a'.repeat(64);
    localStorage.setItem('local_encryption_key_v1', legacyKey);
    const getSetting = jest.fn().mockResolvedValue('');
    const setSetting = jest.fn().mockResolvedValue(true);
    const setManySettings = jest.fn().mockResolvedValue(true);
    (window as any).mlc = { isElectron: true, getSetting, setSetting, setManySettings };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe(legacyKey);
    expect(setManySettings).toHaveBeenCalledWith({ localDataKey: legacyKey, localEncryptionKey: null });
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
  });

  it('avoids localStorage persistence when electron secure settings are unavailable', async () => {
    localStorage.setItem('local_encryption_key_v1', 'b'.repeat(64));
    (window as any).mlc = { isElectron: true };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBe(64);
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
  });
});
