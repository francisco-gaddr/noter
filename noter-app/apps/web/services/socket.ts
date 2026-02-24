import { io } from 'socket.io-client';

const stripApiSuffix = (url: string) => url.replace(/\/api\/?$/, '');

const normalizeHttp = (url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
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
    if (envUrl.startsWith('http')) return stripApiSuffix(envUrl);
    return 'https://localhost:3001';
  }

  const origin = options?.origin ?? window.location.origin;
  if (envUrl) {
    if (envUrl.startsWith('http')) return stripApiSuffix(envUrl);
    return normalizeHttp(origin);
  }

  return normalizeHttp(origin);
};

const socketBaseUrl = resolveSocketBaseUrl();

export const socket = io(socketBaseUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  secure: socketBaseUrl.startsWith('https://'),
  withCredentials: true,
});

export const connectSocket = () => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    (socket as any).auth = { token };
  }
  if (!socket.connected) socket.connect();
};

export const disconnectSocket = () => {
  if (socket.connected) socket.disconnect();
};
