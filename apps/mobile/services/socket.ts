import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

const stripApiSuffix = (url: string) => url.replace(/\/api\/?$/, '');

const toSecureHttp = (url: string) => {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
};

export const resolveSocketBaseUrl = (apiUrl?: string) => {
  if (!apiUrl) return 'https://localhost:3001';
  if (apiUrl.startsWith('http')) return toSecureHttp(stripApiSuffix(apiUrl));
  return 'https://localhost:3001';
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
    console.log('Socket connection error:', err);
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
