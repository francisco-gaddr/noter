import { io } from 'socket.io-client';

const URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001';

export const socket = io(URL, {
  autoConnect: false,
  reconnection: true,
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
