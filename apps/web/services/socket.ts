import { io } from 'socket.io-client';

const URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001';

export const socket = io(URL, {
  autoConnect: true,
  reconnection: true,
});
