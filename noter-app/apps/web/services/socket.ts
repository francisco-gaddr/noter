import { io } from 'socket.io-client';

// Use the configured API URL but remove the /api suffix for socket connection
// This ensures it goes through the same Nginx proxy as the API calls
const getSocketUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  
  // If we have a configured API URL, use it (stripping /api)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    // Handle both absolute (http://...) and relative (/api) URLs
    if (apiUrl.startsWith('http')) {
      return apiUrl.replace('/api', '');
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
