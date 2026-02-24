import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import mongoose from 'mongoose';
import http from 'http';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from './utils/logger';
import noteRoutes from './routes/notes';
import taskRoutes from './routes/tasks';
import authRoutes from './routes/auth';
import { authMiddleware } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorMiddleware';

dotenv.config();

const app = express();
const server = http.createServer(app);
const port = parseInt(process.env.PORT || '3001', 10);

app.set('trust proxy', 1);

// Security & Performance Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(mongoSanitize()); // Prevent NoSQL injection

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all requests
app.use(limiter);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingInterval: 25000,
  pingTimeout: 20000
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Track users in rooms
// socketId -> User info
const socketUsers = new Map<string, any>();

io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string | undefined;
  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }
  if (token === 'demo-token') {
    (socket.data as any).userId = 'demo-user-id';
    next();
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (socket.data as any).userId = decoded.userId;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  const userId = (socket.data as any).userId as string | undefined;
  if (userId) {
    socket.join(`user:${userId}`);
  }

  socket.on('note:join', ({ noteId, user }) => {
    if (userId && user?._id && user._id !== userId) return;
    socket.join(noteId);
    socketUsers.set(socket.id, user);
    
    // Get all users in this room
    const clients = io.sockets.adapter.rooms.get(noteId);
    const users: any[] = [];
    if (clients) {
        clients.forEach(clientId => {
            const u = socketUsers.get(clientId);
            if (u) {
                // Avoid duplicates if same user has multiple tabs?
                // For now, list all connections or unique users?
                // Let's list unique users by _id
                if (!users.find(existing => existing._id === u._id)) {
                    users.push(u);
                }
            }
        });
    }
    io.to(noteId).emit('note:active-users', { noteId, users });
  });

  socket.on('note:leave', ({ noteId, user }) => {
    socket.leave(noteId);
    // We don't remove from socketUsers yet because they might be in other rooms? 
    // Actually usually one note at a time.
    // But let's just re-calculate users in room.
    
    const clients = io.sockets.adapter.rooms.get(noteId);
    const users: any[] = [];
    if (clients) {
        clients.forEach(clientId => {
            const u = socketUsers.get(clientId);
            if (u && !users.find(existing => existing._id === u._id)) {
                users.push(u);
            }
        });
    }
    io.to(noteId).emit('note:active-users', { noteId, users });
  });

  socket.on('disconnecting', () => {
    const user = socketUsers.get(socket.id);
    if (user) {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                // It's a note room (probably)
                // We need to emit new user list AFTER this socket leaves
                // But we are in 'disconnecting', so we are still in room.
                // We can filter out current socket.
                 const clients = io.sockets.adapter.rooms.get(room);
                 const users: any[] = [];
                 if (clients) {
                     clients.forEach(clientId => {
                         if (clientId !== socket.id) {
                            const u = socketUsers.get(clientId);
                            if (u && !users.find(existing => existing._id === u._id)) {
                                users.push(u);
                            }
                         }
                     });
                 }
                 io.to(room).emit('note:active-users', { noteId: room, users });
            }
        }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    socketUsers.delete(socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Noter Backend Running');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);

// Error Handler
app.use(errorHandler);

// MongoDB connection
const mongoUri = process.env.MONGO_URI;

const startServer = async () => {
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false, // Fail immediately if not connected
      });
      console.log('Connected to MongoDB');
      logger.info('Connected to MongoDB');
    } catch (err) {
      console.error('MongoDB connection error:', err);
      logger.error('MongoDB connection error:', err);
      console.log('Running without database connection (some features may fail)');
      // process.exit(1); // Do not exit, allow server to run for diagnostics/offline sync
    }
  } else {
    console.log('MONGO_URI not set, running without database connection');
    logger.info('MONGO_URI not set, running without database connection');
  }

  server.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    logger.info(`Server running at http://0.0.0.0:${port}`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server };
