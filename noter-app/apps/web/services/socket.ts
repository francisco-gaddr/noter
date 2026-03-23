import { io } from 'socket.io-client';
import { getApiBaseUrl } from './api';
import { getWebAuthTokenSync } from './authStorage';

const stripApiSuffix = (url: string) => url.replace(/\/api\/?$/, '');

const normalizeHttp = (url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
};

const toSocketUrl = (httpBase: string) => {
  if (httpBase.startsWith('https://')) return httpBase.replace('https://', 'wss://');
  if (httpBase.startsWith('http://')) return httpBase.replace('http://', 'ws://');
  return `wss://${httpBase}`;
};

export const resolveSocketBaseUrl = (options?: {
  envUrl?: string;
  origin?: string;
  isServer?: boolean;
  apiBaseUrl?: string;
}) => {
  const isServer = options?.isServer ?? typeof window === 'undefined';
  const apiBaseUrl = options?.apiBaseUrl ?? (isServer ? process.env.NEXT_PUBLIC_API_URL : getApiBaseUrl());

  if (apiBaseUrl) {
    if (apiBaseUrl.startsWith('/')) {
      if (isServer) return toSocketUrl('https://localhost:3001');
      const origin = options?.origin ?? window.location.origin;
      return toSocketUrl(normalizeHttp(origin));
    }
    const normalized = normalizeHttp(stripApiSuffix(apiBaseUrl));
    return toSocketUrl(normalized);
  }

  if (isServer) {
    return toSocketUrl('https://localhost:3001');
  }

  const origin = options?.origin ?? window.location.origin;
  return toSocketUrl(normalizeHttp(origin));
};

let socketBaseUrl = resolveSocketBaseUrl();
let socketTokenCache: string | null = null;

export let socket = io(socketBaseUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  secure: socketBaseUrl.startsWith('wss://'),
  withCredentials: true,
});

export const connectSocket = () => {
  const nextBaseUrl = resolveSocketBaseUrl();
  if (nextBaseUrl !== socketBaseUrl) {
    socketBaseUrl = nextBaseUrl;
    socket.disconnect();
    socket = io(socketBaseUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      secure: socketBaseUrl.startsWith('wss://'),
      withCredentials: true,
    });
  }
  const token = socketTokenCache || getWebAuthTokenSync();
  (socket as any).auth = { token };
  if (!socket.connected) socket.connect();
};

export const disconnectSocket = () => {
  if (socket.connected) socket.disconnect();
};

export const setSocketToken = (token: string | null) => {
  socketTokenCache = token;
  (socket as any).auth = { token };
};
