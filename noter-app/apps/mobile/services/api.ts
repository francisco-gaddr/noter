import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createPasswordWrappedEncryption } from '@repo/shared';
import type { AuthResponse } from '@repo/shared';
import { bootstrapLocalEncryptionFromPassword, cacheLocalDataKey, clearLocalDataKey } from './encryptionKey';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const runtimeDevMode =
  (typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : true) && process.env.NODE_ENV !== 'production';

const logDebug = (...args: unknown[]) => {
  if (runtimeDevMode) console.log(...args);
};

const normalizeApiUrl = (input: string) => {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  const normalizedPath = parsed.pathname.endsWith('/api') || parsed.pathname.endsWith('/api/')
    ? parsed.pathname
    : `${parsed.pathname.replace(/\/$/, '')}/api`;
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2';
  if (!runtimeDevMode && protocol === 'http:' && !isLocalHost) {
    throw new Error('Endast HTTPS är tillåtet utanför utvecklingsläge');
  }
  return `${parsed.protocol}//${parsed.host}${normalizedPath.replace(/\/$/, '')}`;
};

// Function to get the API URL dynamically
const getApiUrl = () => {
  // NOTE: We intentionally ignore EXPO_PUBLIC_API_URL on Android if it's localhost
  // to avoid issues on physical devices/emulators where localhost refers to the device itself.
  if (process.env.EXPO_PUBLIC_API_URL) {
    return normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL);
  }

  // Try multiple Expo host hints
  const hostCandidates: (string | undefined)[] = [
    Constants.expoConfig?.hostUri,
    (Constants as any).manifest?.hostUri,
    (Constants as any).manifest?.debuggerHost, // e.g. 192.168.x.x:19000
  ];

  logDebug('Host candidates:', hostCandidates);

  for (const candidate of hostCandidates) {
    if (candidate && typeof candidate === 'string') {
      try {
        // Extract hostname portion before ":" and strip brackets for IPv6
        let host = candidate.split(':')[0];
        host = host.replace(/^\[|\]$/g, '');
        
        // If on Android and host is localhost, force 10.0.2.2 (Emulator) or keep searching if we want LAN
        // For physical devices, we really need the LAN IP. 
        // If 'host' comes from debuggerHost, it SHOULD be the LAN IP.
        // If it is 'localhost', it means the bundler thinks it is on localhost.
        
        if (Platform.OS === 'android' && (host === 'localhost' || host === '127.0.0.1')) {
            // If we are on Android and the candidate says localhost, it's likely wrong for a physical device.
            // But for an emulator, 10.0.2.2 is correct.
            // We'll return 10.0.2.2 as a safe default for emulators, but for physical devices this won't work.
            // There is no perfect way to guess the LAN IP if the bundler doesn't tell us.
            return 'http://10.0.2.2:3001/api';
        }
        
        return `http://${host}:3001/api`;
      } catch {}
    }
  }

  return Platform.select({
    android: 'http://10.0.2.2:3001/api',
    ios: 'http://localhost:3001/api',
    default: 'http://localhost:3001/api',
  });
};

export let API_URL = getApiUrl();
type SessionAuthResponse = AuthResponse & { refreshToken?: string };

export const setApiUrl = async (url: string) => {
  API_URL = normalizeApiUrl(url);
  try {
    await SecureStore.setItemAsync('custom_api_url', API_URL);
  } catch (e) {
    console.warn('Failed to save custom API URL', e);
  }
  logDebug('API_URL updated to:', API_URL);
};

export const initApiUrl = async () => {
    try {
        const stored = await SecureStore.getItemAsync('custom_api_url');
    if (stored) {
      API_URL = normalizeApiUrl(stored);
      logDebug('API_URL loaded from storage:', API_URL);
    }
    } catch (e) {
        console.warn('Failed to load custom API URL', e);
    }
};

logDebug('API_URL configured as:', API_URL);

let authToken: string | null = null;
let refreshToken: string | null = null;
let unauthorizedHandler: null | (() => void | Promise<void>) = null;
let tokenUpdateHandler: null | ((token: string | null) => void | Promise<void>) = null;
let refreshPromise: Promise<string | null> | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

export const setTokenUpdateHandler = (handler: null | ((token: string | null) => void | Promise<void>)) => {
  tokenUpdateHandler = handler;
};

export const setUnauthorizedHandler = (handler: null | (() => void | Promise<void>)) => {
  unauthorizedHandler = handler;
};

const persistSession = async (data: Partial<SessionAuthResponse>) => {
  if (typeof data.token === 'string') {
    authToken = data.token;
    await SecureStore.setItemAsync('token', data.token);
    await tokenUpdateHandler?.(data.token);
  }
  if (typeof data.refreshToken === 'string') {
    refreshToken = data.refreshToken;
    await SecureStore.setItemAsync('refresh_token', data.refreshToken);
  }
};

const clearSession = async (invokeUnauthorized: boolean) => {
  authToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync('token');
  await SecureStore.deleteItemAsync('refresh_token');
  await tokenUpdateHandler?.(null);
  if (invokeUnauthorized) {
    try {
      await unauthorizedHandler?.();
    } catch {}
  }
};

const refreshSession = async (): Promise<string | null> => {
  if (!refreshToken) {
    refreshToken = await SecureStore.getItemAsync('refresh_token');
  }
  if (!refreshToken) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      await clearSession(false);
      return null;
    }
    const data: SessionAuthResponse = await response.json();
    await persistSession(data);
    return data.token || null;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
};

const isAbortLikeError = (error: unknown) => {
  const err = error as any;
  const name = String(err?.name ?? '').toLowerCase();
  const message = String(err?.message ?? '').toLowerCase();
  return (
    name === 'aborterror' ||
    message === 'aborted' ||
    message.includes('abort') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
};

const getRequestTimeoutMs = (endpoint: string, method: string) => {
  if (method === 'GET' && endpoint === '/notes') return 45000;
  if (method === 'GET' && endpoint.startsWith('/tasks')) return 30000;
  if (method === 'GET') return 20000;
  return 15000;
};

const handleApiError = (error: any, url: string) => {
    console.error(`[API Error] Request to ${url} failed:`, error);
    
    let message = error.message || 'Unknown error';
    
    // Check for Network request failed
    if (message === 'Network request failed' || message.includes('Network request failed')) {
         const hint = url.includes('localhost') || url.includes('127.0.0.1')
        ? '\n\nTips: "localhost" fungerar inte på fysisk enhet. Byt till din dators lokala IP (t.ex. 192.168.x.x) i inställningarna.'
        : '\n\nTips: Kontrollera att enheten är på samma Wi-Fi som servern och att servern körs.';
      
         throw new Error(`Kunde inte nå servern på ${url}.\nFel: ${message}${hint}`);
    }
    
    throw new Error(`Anrop till ${url} misslyckades: ${message}`);
};

export async function login(username: string, password: string) {
  const url = `${API_URL}/auth/login`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || `Login failed with status ${response.status}`);
    }

    const data: SessionAuthResponse = await response.json();
    await bootstrapLocalEncryptionFromPassword(password, data.encryption);
    await persistSession(data);
    return data;
  } catch (error: any) {
    handleApiError(error, url);
  }
}

export async function register(username: string, password: string) {
  const url = `${API_URL}/auth/register`;
  try {
    logDebug(`[API] Registering user: ${username} to ${url}`);
    const encryption = createPasswordWrappedEncryption(password);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        wrappedDataKey: encryption.wrappedDataKey,
        encryptionSalt: encryption.salt,
        keyWrapVersion: encryption.keyWrapVersion,
        keyWrapKdf: encryption.keyWrapKdf,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Registration failed';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = `Registration failed: ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data: SessionAuthResponse = await response.json();
    await cacheLocalDataKey(encryption.dataKey);
    await persistSession(data);
    return data;
  } catch (error: any) {
    handleApiError(error, url);
  }
}

export async function logout() {
  const tokenToRevoke = refreshToken || await SecureStore.getItemAsync('refresh_token');
  try {
    if (tokenToRevoke) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokenToRevoke }),
      });
    }
  } finally {
    await clearSession(false);
    await clearLocalDataKey().catch(() => {});
  }
}

export async function fetchWithAuth(
  endpoint: string,
  options: (RequestInit & { skipUnauthorized?: boolean; timeoutMs?: number }) = {}
) {
  const url = `${API_URL}${endpoint}`;
  const { skipUnauthorized, timeoutMs: timeoutOverrideMs, ...fetchOptions } = options;
  
  // If no token in memory, try to get from SecureStore (fallback/recovery)
  if (!authToken) {
    authToken = await SecureStore.getItemAsync('token');
    if (!authToken) {
      authToken = await SecureStore.getItemAsync('auth_token');
      if (authToken) {
        await SecureStore.setItemAsync('token', authToken);
      }
    }
  }
  if (!refreshToken) {
    refreshToken = await SecureStore.getItemAsync('refresh_token');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  } else {
    // Fallback for demo/dev if needed, or maybe we shouldn't send it if not logged in?
    // User requested "proper login", so let's rely on the token.
    // However, for initial sync or if user is "demo-user", we might need handling.
    // For now, let's assume we need a token.
    // console.warn('No auth token available for request to', endpoint);
  }

  const maxRetries = 3;
  const baseDelayMs = 500;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const timeoutMs = timeoutOverrideMs ?? getRequestTimeoutMs(endpoint, method);

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      logDebug(`[API] Requesting: ${method} ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          ...fetchOptions,
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        console.warn(`[API] Error ${response.status} from ${url}`);
        if (response.status === 401) {
          const refreshedToken =
            !skipUnauthorized && endpoint !== '/auth/refresh' && endpoint !== '/auth/logout'
              ? await refreshSession()
              : null;
          if (refreshedToken) {
            headers['Authorization'] = `Bearer ${refreshedToken}`;
            continue;
          }
          const err: any = new Error('Unauthorized: Session expired or invalid credentials');
          err.status = 401;
          err.url = url;
          err.method = String(fetchOptions.method || 'GET').toUpperCase();
          if (!skipUnauthorized) {
            await clearSession(true);
          }
          throw err;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const body = contentType.includes('application/json')
          ? await response.json().catch(() => null)
          : await response.text().catch(() => null);

        const serverMessage =
          isRecord(body) && typeof body.message === 'string' ? body.message : 'Request failed';

        const shouldHintApiMismatch =
          response.status === 404 &&
          (endpoint.startsWith('/notes') || endpoint.startsWith('/tasks')) &&
          isRecord(body) &&
          isRecord(body.details) &&
          typeof body.details.path === 'string' &&
          body.details.path.startsWith('/api/');

        const baseUrl = API_URL.replace(/\/api\/?$/, '');
        const hint = shouldHintApiMismatch
          ? ` Kontrollera att du pekar på backend (inte Next-app) och att backend kör på ${baseUrl}.`
          : '';

        const err: any = new Error(`${serverMessage}${hint}`);
        err.status = response.status;
        err.url = url;
        err.method = method;
        err.details = body;

        const shouldRetry =
          attempt < maxRetries - 1 && (response.status >= 500 || response.status === 429);
        if (shouldRetry) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        logDebug(`[API] Server error details:`, body);
        throw err;
      }

      const data = await response.json();
      logDebug(
        `[API] Success from ${url}`,
        Array.isArray(data) ? `(Array length: ${data.length})` : '(Object)'
      );
      return data;
    } catch (error: any) {
      const status = (error as any)?.status;
      let message = error?.message ? String(error.message) : 'Request failed';
      const isAbortError = isAbortLikeError(error);

      const isNetworkError =
        message === 'Network request failed' ||
        message.toLowerCase().includes('network error') ||
        message.toLowerCase().includes('failed to fetch');

      const shouldRetry = attempt < maxRetries - 1 && (isNetworkError || isAbortError || status >= 500);
      if (shouldRetry) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isAbortError) {
        const err: any = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s while loading ${endpoint}`);
        err.code = 'REQUEST_TIMEOUT';
        err.url = url;
        err.method = method;
        err.status = 408;
        throw err;
      }

      if (isNetworkError) {
        message = `Could not connect to server at ${API_URL}. Please check:
1. You are on the same Wi-Fi.
2. The server is running.
3. The API URL is correct (Settings > API URL).`;
      }

      logDebug(
        `[API] Network/Logic failed to ${url}`,
        status ? `${status} ${message}` : message
      );

      if (message !== error?.message) {
        throw new Error(message);
      }
      throw error;
    }
  }

  throw new Error(`Request failed after ${maxRetries} attempts`);
}
