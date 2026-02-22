import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

const stripApiSuffix = (url: string) => url.replace(/\/api\/?$/, '');

const normalizeBaseUrl = (url: string) => {
  try {
    const parsed = new URL(stripApiSuffix(url));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return stripApiSuffix(url);
  }
};

export const resolveSocketBaseUrl = (apiUrl?: string) => {
  if (!apiUrl) return 'https://daylited.com';
  const normalized = normalizeBaseUrl(apiUrl);
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  return 'https://daylited.com';
};

let socket: Socket | null = null;

export const initSocket = (token?: string | null) => {
  if (socket) {
    if (token) {
      // Update auth token if provided and reconnect
      (socket as any).auth = { token };
      if (!socket.connected) {
        socket.connect();
      } else {
        // Force reconnection to apply new auth
        socket.disconnect().connect();
      }
    }
    return socket;
  }
  
  const baseUrl = resolveSocketBaseUrl(API_URL);

  console.log('Connecting socket to:', baseUrl);

  socket = io(baseUrl, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    secure: true,
    auth: token ? { token } : undefined
  });

  if (token) socket.connect();

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
  
  socket.on('connect_error', (err) => {
    console.log(`Socket connection error to ${baseUrl}:`, err.message);
  });

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
