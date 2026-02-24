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
    secure: baseUrl.startsWith('https://'),
    path: '/socket.io/',
    withCredentials: true,
    auth: token ? { token } : undefined
  });

  const activeSocket = socket;
  if (!activeSocket) return null;

  if (token) activeSocket.connect();

  activeSocket.on('connect', () => {
    console.log('Socket connected');
    activeSocket.io.opts.reconnectionDelay = 1000;
  });

  activeSocket.on('disconnect', (reason) => {
    console.log('Socket disconnected, reason:', reason);
    if (reason === 'io server disconnect') {
      console.log('Server disconnected, attempting reconnection...');
      setTimeout(() => activeSocket.connect(), 1000);
    }
  });
  
  activeSocket.on('connect_error', (err) => {
    console.log(`Socket connection error to ${baseUrl}:`, err.message);
    
    const currentDelay = activeSocket.io.opts.reconnectionDelay || 1000;
    const maxDelay = activeSocket.io.opts.reconnectionDelayMax || 5000;
    activeSocket.io.opts.reconnectionDelay = Math.min(currentDelay * 1.5, maxDelay);
    
    if (err.message.includes('xhr poll error')) {
      console.log('XHR poll error - server may be unreachable or CORS issues');
    } else if (err.message.includes('websocket error')) {
      console.log('WebSocket error - falling back to polling');
    } else if (err.message.includes('timeout')) {
      console.log('Connection timeout - server may be slow or unreachable');
    }
  });

  activeSocket.on('error', (err) => {
    console.log('Socket error:', err);
  });

  activeSocket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Socket reconnection attempt ${attemptNumber}`);
  });

  activeSocket.on('reconnect_failed', () => {
    console.log('Socket reconnection failed after maximum attempts');
  });

  return activeSocket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

// Health check mechanism for WebSocket connection
export const checkSocketHealth = (): boolean => {
  if (!socket) return false;
  return socket.connected && !socket.disconnected;
};

// Get current connection status with detailed info
export const getSocketStatus = () => {
  if (!socket) return { connected: false, status: 'not_initialized' };
  
  return {
    connected: socket.connected,
    disconnected: socket.disconnected,
    status: socket.connected ? 'connected' : 'disconnected',
    transport: (socket as any).io?.engine?.transport?.name || 'unknown',
    attempts: (socket as any).io?.reconnectionAttempts || 0,
    delay: (socket as any).io?.reconnectionDelay || 0
  };
};
