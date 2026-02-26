import { io } from 'socket.io-client';
import { getEncryptedItem } from './secureStorage';

const stripApiSuffix = (url: string) => url.replace(/\/api\/?$/, '');

const toSecureHttp = (url: string) => {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
};

export const resolveSocketBaseUrl = (options?: {
  envUrl?: string;
  origin?: string;
  isServer?: boolean;
}) => {
  const envUrl = options?.envUrl ?? process.env.NEXT_PUBLIC_API_URL;
  const isServer = options?.isServer ?? typeof window === 'undefined';

  if (isServer) {
    if (!envUrl) return 'https://localhost:3001';
    if (envUrl.startsWith('http')) return toSecureHttp(stripApiSuffix(envUrl));
    return 'https://localhost:3001';
  }

  const origin = options?.origin ?? window.location.origin;
  if (envUrl) {
    if (envUrl.startsWith('http')) return toSecureHttp(stripApiSuffix(envUrl));
    return toSecureHttp(origin);
  }

  return toSecureHttp(origin);
};

export const socket = io(resolveSocketBaseUrl(), {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  secure: true,
});

export const connectSocket = () => {
  if (typeof window !== 'undefined') {
    const token = getEncryptedItem('token');
    if (!token) return;
    (socket as any).auth = { token };
  }
  if (!socket.connected) socket.connect();
};

export const disconnectSocket = () => {
  if (socket.connected) socket.disconnect();
};
