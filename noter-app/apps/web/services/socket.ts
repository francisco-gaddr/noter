import { io } from 'socket.io-client';

// Use the configured API URL but remove the /api suffix for socket connection
// This ensures it goes through the same Nginx proxy as the API calls
const getSocketUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  
  // Smart detection: If configured URL is localhost but we are not, use window.location.origin
  if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) && 
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.origin;
  }

  // If we have a configured API URL, use it (stripping /api)
  if (envUrl) {
    // Handle both absolute (http://...) and relative (/api) URLs
    if (envUrl.startsWith('http')) {
      return envUrl.replace('/api', '');
    }
    // If relative like '/api', construct full URL from window.location
    return window.location.origin;
  }
  
  // Fallback to current origin
  return window.location.origin;
};

export const socket = io(getSocketUrl(), {
  autoConnect: false,
  reconnection: true,
  path: '/socket.io/', // Explicitly set path to match Nginx config
  transports: ['websocket', 'polling'], // Prefer websocket
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
