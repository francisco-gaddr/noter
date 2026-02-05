import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Function to get the API URL dynamically
const getApiUrl = () => {
  // NOTE: We intentionally ignore EXPO_PUBLIC_API_URL on Android if it's localhost
  // to avoid issues on physical devices/emulators where localhost refers to the device itself.
  if (process.env.EXPO_PUBLIC_API_URL) {
    const envUrl = process.env.EXPO_PUBLIC_API_URL;
    if (Platform.OS === 'android' && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
       console.log('Ignoring EXPO_PUBLIC_API_URL (localhost) on Android to detect correct LAN IP');
    } else {
       return envUrl;
    }
  }

  // Try multiple Expo host hints
  const hostCandidates: (string | undefined)[] = [
    Constants.expoConfig?.hostUri,
    (Constants as any).manifest?.hostUri,
    (Constants as any).manifest?.debuggerHost, // e.g. 192.168.x.x:19000
  ];

  console.log('Host candidates:', hostCandidates);

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
    await SecureStore.setItemAsync('custom_api_url', url);
  } catch (e) {
    console.warn('Failed to save custom API URL', e);
  }
  console.log('API_URL updated to:', API_URL);
};

export const initApiUrl = async () => {
    try {
        const stored = await SecureStore.getItemAsync('custom_api_url');
    if (stored) {
      // Sanity check: If stored is localhost/127.0.0.1 but we are on Android, ignore it to allow smart default
      if (Platform.OS === 'android' && (stored.includes('localhost') || stored.includes('127.0.0.1'))) {
        console.log('Ignoring stored localhost/127.0.0.1 API URL on Android, reverting to smart default');
        await SecureStore.deleteItemAsync('custom_api_url');
      } else {
        API_URL = stored;
        console.log('API_URL loaded from storage:', API_URL);
      }
    }
    } catch (e) {
        console.warn('Failed to load custom API URL', e);
    }
};

console.log('API_URL configured as:', API_URL);

let authToken: string | null = null;
let unauthorizedHandler: null | (() => void | Promise<void>) = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

export const setUnauthorizedHandler = (handler: null | (() => void | Promise<void>)) => {
  unauthorizedHandler = handler;
};

export async function login(username: string, password: string) {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || `Login failed with status ${response.status}`);
    }

    const data = await response.json();
    if (data.token) {
      await SecureStore.setItemAsync('auth_token', data.token);
      authToken = data.token;
      
      // Initialize socket with new token
      // We need to dynamic import or access the socket service to avoid circular deps if possible
      // But for now, let's assume the user will reload or we handle it in the store
    }
    return data;
  } catch (error: any) {
    console.error('Login error:', error);
    
    // Detailed error logging for debugging
    if (error.message && (error.message.includes('Network request failed') || error.message.includes('fetch'))) {
        console.log('Network Error detected. Checking API_URL:', API_URL);
        if (API_URL.includes('localhost') || API_URL.includes('127.0.0.1')) {
             throw new Error(`Connection failed to ${API_URL}. \n\nOn Android, 'localhost' refers to the device itself, not your computer.\n\nUse your computer's LAN IP (e.g. 192.168.1.x) instead.`);
        }
        if (!API_URL.startsWith('http')) {
             throw new Error(`Invalid API URL: ${API_URL}. Must start with http:// or https://`);
        }
        // Check for cleartext traffic issues (though we added the flag)
        if (API_URL.startsWith('http://') && Platform.OS === 'android') {
             // We can't easily detect if cleartext is blocked, but we can hint it
             throw new Error(`Network request failed to ${API_URL}.\n\nEnsure:\n1. Server is running\n2. Phone is on same Wi-Fi\n3. URL is correct (no typos)`);
        }
    }
    
    throw error;
  }
}

export async function register(username: string, password: string) {
  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error(error.message || `Registration failed with status ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    console.error('Register error:', error);
    if (error.message && (error.message.includes('Network request failed') || error.message.includes('fetch'))) {
        if (API_URL.includes('localhost') || API_URL.includes('127.0.0.1')) {
             throw new Error(`Connection failed to ${API_URL}. \n\nOn Android, 'localhost' refers to the device itself. Use LAN IP.`);
        }
        throw new Error(`Network request failed to ${API_URL}. Check server and Wi-Fi.`);
    }
    throw error;
  }
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const url = `${API_URL}${endpoint}`;
  
  // If no token in memory, try to get from SecureStore (fallback/recovery)
  if (!authToken) {
    authToken = await SecureStore.getItemAsync('token');
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
      console.log(`[API] Requesting: ${options.method || 'GET'} ${url}`);
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        console.warn(`[API] Error ${response.status} from ${url}`);
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

        console.error(`[API] Server error details:`, body);
        throw err;
      }

      const data = await response.json();
      console.log(
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

      console.error(
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
