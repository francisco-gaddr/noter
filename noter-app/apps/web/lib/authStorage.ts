/**
 * Encrypted-at-rest storage for the auth credential (JWT) + the cached user object.
 *
 * Why: a bare JWT in localStorage is the single most valuable target for a generic
 * credential scraper (malicious dependency / browser extension / naive XSS that greps
 * localStorage for token-looking strings). We wrap both at rest with a FIXED key that is
 * independent of the E2E data-key state, so reads/writes are deterministic across login,
 * E2E unlock, and auto-lock transitions (unlike the per-user data key, which comes and
 * goes). Backward-compatible: any value that isn't one of our ciphertexts (legacy
 * plaintext tokens, test fixtures) is read through unchanged.
 *
 * This protects the at-rest credential; the bearer token is still sent over TLS (WSS/HTTPS)
 * for transport. It is defense-in-depth, not a substitute for httpOnly cookies.
 */
import { encrypt, decrypt } from '@repo/shared';

// Fixed, app-local key (not the per-user E2E data key) so token access never depends on
// whether E2E is unlocked. The goal is to defeat generic scrapers, not to make the value
// unrecoverable by someone who already executes in the page.
const AUTH_AT_REST_KEY = 'noter-auth-store-v1';

// Our writes always use the legacy CryptoJS AES path (explicit key), whose base64 output
// begins with "U2FsdGVk" (= "Salted__"). Detecting that locally avoids depending on a
// shared helper that some unit-test mocks don't stub.
const looksEncrypted = (v: string): boolean => typeof v === 'string' && v.startsWith('U2FsdGVk');

const hasLS = (): boolean => typeof localStorage !== 'undefined';

export const readStoredToken = (): string | null => {
  if (!hasLS()) return null;
  const raw = localStorage.getItem('token');
  if (!raw) return null;
  if (looksEncrypted(raw)) {
    const d = decrypt(raw, AUTH_AT_REST_KEY);
    return d || null;
  }
  return raw; // legacy plaintext / test fixture
};

export const writeStoredToken = (token: string | null): void => {
  if (!hasLS()) return;
  if (!token) { localStorage.removeItem('token'); return; }
  try { localStorage.setItem('token', encrypt(token, AUTH_AT_REST_KEY)); }
  catch { localStorage.setItem('token', token); }
};

export const readStoredUser = <T = any>(): T | null => {
  if (!hasLS()) return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    const json = looksEncrypted(raw) ? decrypt(raw, AUTH_AT_REST_KEY) : raw;
    return JSON.parse(json || 'null') as T;
  } catch {
    return null;
  }
};

export const writeStoredUser = (user: unknown): void => {
  if (!hasLS()) return;
  if (!user) { localStorage.removeItem('user'); return; }
  try { localStorage.setItem('user', encrypt(JSON.stringify(user), AUTH_AT_REST_KEY)); }
  catch { /* best-effort */ }
};
