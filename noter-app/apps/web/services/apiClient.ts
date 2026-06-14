/**
 * Single place for talking to the Noter backend from the web/Electron client.
 *
 * REST lives in ./api (the `api` object). This module owns the cross-cutting
 * concerns shared by REST and GraphQL — resolving the auth token (store →
 * localStorage/sessionStorage → Electron bridge), building the GraphQL endpoint
 * URL from the configured base, the auth headers, and the GraphQL request itself.
 *
 * Anything that needs to change about how the client authenticates, which URL it
 * targets, or how API errors surface should change HERE, not in components.
 */
import { getApiBaseUrl } from './api';
import { useStore } from '../stores/useStore';
import { readStoredToken } from '../lib/authStorage';

const isElectron = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).mlc?.isElectron);

/**
 * Resolve the bearer token, most-authoritative source first. Async because the
 * Electron bridge (mlc.getSetting) is async. Mirrors the previous AISidebar logic
 * so behaviour is unchanged — it's just no longer duplicated per component.
 */
export const resolveAuthToken = async (): Promise<string> => {
  // 1. Live store state (avoids closure staleness).
  const stateToken = useStore.getState().token;
  if (stateToken) return stateToken;

  // 2. Browser storage (encrypted token, then legacy auth_token / session fallbacks).
  if (typeof window !== 'undefined') {
    const local =
      readStoredToken() ||
      localStorage.getItem('auth_token') ||
      sessionStorage.getItem('token') ||
      sessionStorage.getItem('auth_token');
    if (local) return local;
  }

  // 3. Electron settings bridge (token, then legacy key).
  if (isElectron() && (window as any).mlc?.getSetting) {
    const stored = await (window as any).mlc.getSetting('token');
    if (stored) return stored;
    const legacy = await (window as any).mlc.getSetting('auth_token');
    if (legacy) return legacy;
  }

  return '';
};

const cleanBase = (): string =>
  getApiBaseUrl().trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().replace(/\/+$/, '');

/**
 * GraphQL endpoint from the configured API base. Tolerates a base that already
 * ends in /graphql or /api, and rewrites the /app/api subpath (daylited.com/app)
 * to the real /api root.
 */
export const resolveGraphqlUrl = (): string => {
  let base = cleanBase();
  if (base.endsWith('/graphql')) base = base.replace(/\/graphql$/, '');
  if (base.includes('/app/api')) return `${base.replace('/app/api', '/api')}/graphql`;
  if (base.endsWith('/api')) return `${base}/graphql`;
  return `${base}/api/graphql`;
};

/** Auth + content-type headers for a JSON request (token trimmed of stray quotes). */
export const buildAuthHeaders = async (extra?: Record<string, string>): Promise<Record<string, string>> => {
  let token = await resolveAuthToken();
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
};

/** Execute a GraphQL query/mutation and return `data` (throws on GraphQL errors). */
export const graphqlRequest = async <T = any>(query: string, variables: Record<string, any>): Promise<T> => {
  const res = await fetch(resolveGraphqlUrl(), {
    method: 'POST',
    headers: await buildAuthHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || 'GraphQL error');
  }
  return json.data as T;
};
