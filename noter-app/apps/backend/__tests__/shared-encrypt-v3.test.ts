import { clearEncryptionKey, decryptV3, encryptV3, isV3Ciphertext, setEncryptionKey } from '../../../packages/shared/src/encrypt';

describe('shared AES-GCM v3 helpers', () => {
  beforeEach(() => {
    setEncryptionKey('a'.repeat(64));
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('round-trips v3 ciphertext with AES-GCM', async () => {
    const ciphertext = await encryptV3('Hemlig text');
    expect(isV3Ciphertext(ciphertext)).toBe(true);
    await expect(decryptV3(ciphertext)).resolves.toBe('Hemlig text');
  });

  it('fails closed with the wrong runtime key', async () => {
    const ciphertext = await encryptV3('Hemlig text');
    setEncryptionKey('b'.repeat(64));
    await expect(decryptV3(ciphertext)).resolves.toBe('');
  });

  it('derives a stable AES-GCM key from non-hex passphrases', async () => {
    clearEncryptionKey();
    const ciphertext = await encryptV3('Passphrase text', 'custom passphrase');
    await expect(decryptV3(ciphertext, 'custom passphrase')).resolves.toBe('Passphrase text');
  });
});
