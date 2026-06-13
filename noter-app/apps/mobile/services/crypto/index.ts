/**
 * Mobile adapter wiring the dependency-injected keyBootstrap to real services:
 * the authenticated API (`fetchWithAuth`) and device Keychain (`expo-secure-store`).
 *
 * Public surface:
 *   - restoreCryptoFromDevice(): call at app start (no password). Re-activates v3
 *     from the Keychain backup if the device is enrolled; harmless no-op otherwise.
 *   - enrollOrUnlockCrypto(password): call from the "Enhanced encryption" toggle /
 *     login with the password in hand. Enrols or unlocks per-user E2E.
 *   - lockCrypto(): clear the active key on lock/logout (legacy reads still work).
 */
import * as SecureStore from 'expo-secure-store';
import { fetchWithAuth } from '../api';
import {
  restoreFromDevice,
  enrollOrUnlock,
  recoverWithCode,
  changePassword,
  lockCrypto,
  type BootstrapDeps,
  type KeyBundle,
  type EnrollOutcome,
} from './keyBootstrap';

const DATA_KEY_STORE = 'v3_data_key';

const deps: BootstrapDeps = {
  getBundle: async () => {
    const res = await fetchWithAuth('/api/keys/bundle', { method: 'GET', skipUnauthorized: true });
    if (res.status === 404) return null; // not enrolled yet
    if (!res.ok) throw new Error(`key bundle fetch failed (${res.status})`);
    return (await res.json()) as KeyBundle;
  },
  putBundle: async (bundle) => {
    const res = await fetchWithAuth('/api/keys/bundle', {
      method: 'PUT',
      body: JSON.stringify(bundle),
    });
    if (!res.ok) throw new Error(`key bundle save failed (${res.status})`);
  },
  secureGetDataKey: () => SecureStore.getItemAsync(DATA_KEY_STORE),
  secureSetDataKey: (b64) => SecureStore.setItemAsync(DATA_KEY_STORE, b64),
};

export const restoreCryptoFromDevice = (): Promise<boolean> => restoreFromDevice(deps);
export const enrollOrUnlockCrypto = (password: string): Promise<EnrollOutcome> =>
  enrollOrUnlock(password, deps);
export const recoverCryptoWithCode = (code: string): Promise<void> => recoverWithCode(code, deps);
/** Change the E2E password (re-wraps the dataKey; no content is re-encrypted). */
export const changeCryptoPassword = (oldPassword: string, newPassword: string): Promise<void> =>
  changePassword(oldPassword, newPassword, deps);

/** Forget the device's v3 key entirely (e.g. on logout / disable E2E). */
export const forgetDeviceCrypto = async (): Promise<void> => {
  lockCrypto();
  await SecureStore.deleteItemAsync(DATA_KEY_STORE).catch(() => undefined);
};

export { lockCrypto };
