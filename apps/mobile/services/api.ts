import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { encrypt, decrypt } from '@repo/shared';
import { logDebug, logError, logWarn } from './logger';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Function to get the API URL dynamically
const getApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Try multiple Expo host hints
  const hostCandidates: (string | undefined)[] = [
    Constants.expoConfig?.hostUri,
    (Constants as any).manifest?.hostUri,
    (Constants as any).manifest?.debuggerHost, // e.g. 192.168.x.x:19000
  ];

  for (const candidate of hostCandidates) {
    if (candidate && typeof candidate === 'string') {
      try {
        // Extract hostname portion before ":" and strip brackets for IPv6
        let host = candidate.split(':')[0];
        host = host.replace(/^\[|\]$/g, '');
        return `http://${host}:3001/api`;
      } catch {}
    }
  }

  if (Constants.appOwnership && Constants.appOwnership !== 'expo' && Constants.appOwnership !== 'guest') {
    return 'https://daylited.com/api';
  }

  return Platform.select({
    android: 'http://10.0.2.2:3001/api',
    ios: 'http://localhost:3001/api',
    default: 'http://localhost:3001/api',
  });
};

export let API_URL = getApiUrl();

export const setApiUrl = async (url: string) => {
  // Validate URL format roughly
  if (!url.startsWith('http')) {
      url = `http://${url}`;
  }
  // Ensure it ends with /api if not present, but be careful not to double it
  if (!url.endsWith('/api') && !url.endsWith('/api/')) {
      url = url.replace(/\/$/, '') + '/api';
  }
  // Remove trailing slash
  url = url.replace(/\/$/, '');

  API_URL = url;
  try {
    await SecureStore.setItemAsync('custom_api_url', encrypt(url));
  } catch (e) {
    logWarn('Failed to save custom API URL', e);
  }
  logDebug('API_URL updated to:', API_URL);
};

export const initApiUrl = async () => {
    try {
        const stored = await SecureStore.getItemAsync('custom_api_url');
        if (stored) {
            const decrypted = (() => {
              try {
                return decrypt(stored);
              } catch {
                return stored;
              }
            })();
            API_URL = decrypted;
            logDebug('API_URL loaded from storage:', API_URL);
        }
    } catch (e) {
        logWarn('Failed to load custom API URL', e);
    }
};

logDebug('API_URL configured as:', API_URL);

let authToken: string | null = null;
let unauthorizedHandler: null | (() => void | Promise<void>) = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

export const setUnauthorizedHandler = (handler: null | (() => void | Promise<void>)) => {
  unauthorizedHandler = handler;
};

const handleApiError = (error: any, url: string) => {
    logError(`[API Error] Request to ${url} failed:`, error);
    
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

    return response.json();
  } catch (error: any) {
    handleApiError(error, url);
  }
}

export async function register(username: string, password: string) {
  const url = `${API_URL}/auth/register`;
  try {
    logDebug(`[API] Registering user: ${username} to ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
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

    return response.json();
  } catch (error: any) {
    handleApiError(error, url);
  }
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const url = `${API_URL}${endpoint}`;
  
  // If no token in memory, try to get from SecureStore (fallback/recovery)
  if (!authToken) {
    const stored = await SecureStore.getItemAsync('token');
    if (stored) {
      try {
        authToken = decrypt(stored);
      } catch {
        authToken = stored;
      }
    }
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

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      logDebug(`[API] Requesting: ${options.method || 'GET'} ${url}`);
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        logWarn(`[API] Error ${response.status} from ${url}`);
        if (response.status === 401) {
          await SecureStore.deleteItemAsync('token');
          authToken = null;
          try {
            await unauthorizedHandler?.();
          } catch {}
          throw new Error('Unauthorized: Session expired or invalid credentials');
        }

        const contentType = response.headers.get('content-type') ?? '';
        const body = contentType.includes('application/json')
          ? await response.json().catch(() => null)
          : await response.text().catch(() => null);

        const serverMessage =
          isRecord(body) && typeof body.message === 'string' ? body.message : 'Request failed';

        const method = String(options.method || 'GET').toUpperCase();
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

        logError(`[API] Server error details:`, body);
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

      const isNetworkError =
        message === 'Network request failed' ||
        message.toLowerCase().includes('network error') ||
        message.toLowerCase().includes('failed to fetch');

      const shouldRetry = attempt < maxRetries - 1 && (isNetworkError || status >= 500);
      if (shouldRetry) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isNetworkError) {
        message = `Could not connect to server at ${API_URL}. Please check:
1. You are on the same Wi-Fi.
2. The server is running.
3. The API URL is correct (Settings > API URL).`;
      }

      logError(
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
