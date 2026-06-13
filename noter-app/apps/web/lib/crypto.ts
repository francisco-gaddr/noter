/**
 * Web adapter for the shared v3 E2E key bootstrap.
 *
 * Browser key-persistence decision: the dataKey is kept in `sessionStorage`
 * (per-tab, cleared when the tab/session closes). The server still cannot read it
 * — that's the E2E guarantee — and it survives reloads without forcing the user to
 * re-enter the password. XSS is the residual risk on web and is mitigated by CSP;
 * for higher assurance a future option is in-memory-only (re-derive each load).
 */
import {
  restoreFromDevice,
  enrollOrUnlock,
  recoverWithCode,
  lockCrypto,
  type BootstrapDeps,
  type KeyBundle,
  type EnrollOutcome,
} from '@repo/shared';
import { getApiBaseUrl } from '../services/api';

const DATA_KEY_STORE = 'v3_data_key';

const getToken = (): string | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  } catch {
    return null;
  }
};

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const sessionGet = (key: string): string | null => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
};

const sessionSet = (key: string, value: string): void => {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value);
  } catch {
    /* private mode / disabled storage — key stays in-memory via setActiveDataKey only */
  }
};

const deps: BootstrapDeps = {
  getBundle: async () => {
    const res = await fetch(`${getApiBaseUrl()}/keys/bundle`, { method: 'GET', headers: authHeaders() });
    if (res.status === 404) return null; // not enrolled yet
    if (!res.ok) throw new Error(`key bundle fetch failed (${res.status})`);
    return (await res.json()) as KeyBundle;
  },
  putBundle: async (bundle) => {
    const res = await fetch(`${getApiBaseUrl()}/keys/bundle`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(bundle),
    });
    if (!res.ok) throw new Error(`key bundle save failed (${res.status})`);
  },
  secureGetDataKey: async () => sessionGet(DATA_KEY_STORE),
  secureSetDataKey: async (b64) => sessionSet(DATA_KEY_STORE, b64),
};

export const restoreCryptoFromSession = (): Promise<boolean> => restoreFromDevice(deps);
export const enrollOrUnlockCrypto = (password: string): Promise<EnrollOutcome> => enrollOrUnlock(password, deps);
export const recoverCryptoWithCode = (code: string): Promise<void> => recoverWithCode(code, deps);

/** Forget the session's v3 key (on logout / disable E2E). */
export const forgetSessionCrypto = (): void => {
  lockCrypto();
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(DATA_KEY_STORE);
  } catch {
    /* ignore */
  }
};

export { lockCrypto };
