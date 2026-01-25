import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

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
  
  // Remove /api from the end of API_URL to get the root URL
  const baseUrl = API_URL.replace('/api', '');
  
  console.log('Connecting socket to:', baseUrl);

  socket = io(baseUrl, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
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
    // console.log('Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
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
