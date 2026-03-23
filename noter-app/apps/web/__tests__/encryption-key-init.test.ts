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
    const getSetting = jest.fn().mockResolvedValue('electron-secure-key');
    const setSetting = jest.fn().mockResolvedValue(true);
    (window as any).mlc = { isElectron: true, getSetting, setSetting };
    const { initWebEncryptionKey } = await import('../services/encryptionKey');
    const key = await initWebEncryptionKey();
    expect(key).toBe('electron-secure-key');
    expect(setSetting).toHaveBeenCalledWith('localEncryptionKey', 'electron-secure-key');
    expect(localStorage.getItem('local_encryption_key_v1')).toBeNull();
    expect(mockSetEncryptionKey).toHaveBeenCalledWith('electron-secure-key');
  });
});
