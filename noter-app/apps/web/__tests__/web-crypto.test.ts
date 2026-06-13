import {
  restoreCryptoFromSession,
  enrollOrUnlockCrypto,
  forgetSessionCrypto,
} from '../lib/crypto';
import { generateDataKey, bytesToB64, setActiveDataKey, encrypt, decrypt, isV3, hasActiveDataKey } from '@repo/shared';

jest.setTimeout(60000); // Argon2id is intentionally slow

beforeEach(() => {
  sessionStorage.clear();
  setActiveDataKey(null);
});
afterEach(() => setActiveDataKey(null));

describe('web crypto adapter', () => {
  it('restoreCryptoFromSession activates v3 from a sessionStorage key (no password)', async () => {
    sessionStorage.setItem('v3_data_key', bytesToB64(generateDataKey()));
    const restored = await restoreCryptoFromSession();
    expect(restored).toBe(true);
    const c = encrypt('webbhemlighet');
    expect(isV3(c)).toBe(true);
    expect(decrypt(c)).toBe('webbhemlighet');
  });

  it('restoreCryptoFromSession returns false with no stored key', async () => {
    expect(await restoreCryptoFromSession()).toBe(false);
  });

  it('forgetSessionCrypto clears the key and deactivates v3', async () => {
    sessionStorage.setItem('v3_data_key', bytesToB64(generateDataKey()));
    await restoreCryptoFromSession();
    expect(hasActiveDataKey()).toBe(true);
    forgetSessionCrypto();
    expect(hasActiveDataKey()).toBe(false);
    expect(sessionStorage.getItem('v3_data_key')).toBeNull();
  });

  it('enrols: uploads the wrapped bundle and persists the dataKey in sessionStorage', async () => {
    let putBody: any = null;
    global.fetch = jest.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
      }
      // GET bundle → 404 (not enrolled)
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }) as any;

    const outcome = await enrollOrUnlockCrypto('webb-losenord');
    expect(outcome.result).toBe('enrolled');
    expect(outcome.recoveryCode).toBeTruthy();
    expect(putBody.wrappedDataKey).toMatch(/^v3w:/);
    expect(sessionStorage.getItem('v3_data_key')).toBeTruthy();
    // v3 writes are now active
    expect(isV3(encrypt('x'))).toBe(true);
  });
});
