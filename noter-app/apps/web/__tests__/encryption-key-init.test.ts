const mockSetEncryptionKey = jest.fn();

jest.mock('@repo/shared', () => ({
  setEncryptionKey: (...args: any[]) => mockSetEncryptionKey(...args),
}));

describe('initWebEncryptionKey', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetEncryptionKey.mockReset();
    (window as any).mlc = undefined;
  });

  it('creates key in localStorage for web mode', async () => {
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(localStorage.getItem('local_encryption_key_v1')).toBe(key);
    expect(mockSetEncryptionKey).toHaveBeenCalledWith(key);
  });

  it('stores key via electron secure settings when available', async () => {
    const secureKey = 'd'.repeat(64);
    const getSetting = jest.fn().mockResolvedValue(secureKey);
    const setSetting = jest.fn().mockResolvedValue(true);
    (window as any).mlc = { isElectron: true, getSetting, setSetting };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe(secureKey);
    expect(setSetting).toHaveBeenCalledWith('localEncryptionKey', secureKey);
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
    expect(mockSetEncryptionKey).toHaveBeenCalledWith(secureKey);
  });

  it('migrates valid legacy localStorage key to electron secure storage', async () => {
    const legacyKey = 'a'.repeat(64);
    localStorage.setItem('local_encryption_key_v1', legacyKey);
    const getSetting = jest.fn().mockResolvedValue('');
    const setSetting = jest.fn().mockResolvedValue(true);
    (window as any).mlc = { isElectron: true, getSetting, setSetting };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe(legacyKey);
    expect(setSetting).toHaveBeenCalledWith('localEncryptionKey', legacyKey);
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
