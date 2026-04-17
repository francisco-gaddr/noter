import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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
import aiModelRoutes from './routes/aiModels';
import aiSyncRoutes from './routes/aiSync';
import mcpRoutes from './routes/mcp';
import { authMiddleware, getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorMiddleware';
import { blockSuspiciousRequestPatterns, enforceJsonApiRequests } from './middleware/requestSecurity';
import { createHandler } from 'graphql-http/lib/use/express';
import { toolSchema } from './graphql/schema';
import { getAllowedOrigins, getJwtSecret, getJwtVerifyOptions, isDemoTokenEnabled } from './utils/security';

const dotenvPath = process.env.DOTENV_PATH;
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  const candidate = path.join(process.cwd(), 'apps', 'backend', '.env');
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  } else {
    dotenv.config();
  }
}

const app = express();
const server = http.createServer(app);
const port = parseInt(process.env.PORT || '3001', 10);
const allowedOrigins = getAllowedOrigins();
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 && !isProduction) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
};

// Security & Performance Middleware
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(enforceJsonApiRequests);
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(blockSuspiciousRequestPatterns);

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts, please try again later.'
});

const apiSensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many security-sensitive requests from this IP, please try again later.'
});

const socketConnectionAttempts = new Map<string, { count: number; startedAt: number }>();

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length === 0 && !isProduction ? true : allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingInterval: 25000,
  pingTimeout: 20000
});

// Track users in rooms
// socketId -> User info
const socketUsers = new Map<string, any>();

io.use((socket, next) => {
  const now = Date.now();
  const ip = String(socket.handshake.address || 'unknown');
  const entry = socketConnectionAttempts.get(ip);
  if (!entry || now - entry.startedAt > 60_000) {
    socketConnectionAttempts.set(ip, { count: 1, startedAt: now });
  } else {
    entry.count += 1;
    if (entry.count > 45) {
      next(new Error('Too many connection attempts'));
      return;
    }
    socketConnectionAttempts.set(ip, entry);
  }

  const token = (socket.handshake.auth as any)?.token as string | undefined;
  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }
  if (token === 'demo-token') {
    if (isDemoTokenEnabled()) {
      (socket.data as any).userId = 'demo-user-id';
      next();
      return;
    }
    next(new Error('Unauthorized'));
    return;
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
    const userId = getUserIdFromDecodedToken(decoded);
    if (!userId) {
      next(new Error('Unauthorized'));
      return;
    }
    (socket.data as any).userId = userId;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

const computeRoomUsers = (noteId: string, excludeSocketId?: string) => {
  const clients = io.sockets.adapter.rooms.get(noteId);
  if (!clients) return [];
  const seen = new Set<string>();
  const users: any[] = [];
  clients.forEach(clientId => {
    if (excludeSocketId && clientId === excludeSocketId) return;
    const u = socketUsers.get(clientId);
    if (!u || !u._id) return;
    const key = String(u._id);
    if (seen.has(key)) return;
    seen.add(key);
    users.push(u);
  });
  return users;
};

io.on('connection', (socket) => {
  logger.debug('Socket connected', { socketId: socket.id });
  const userId = (socket.data as any).userId as string | undefined;
  if (userId) {
    socket.join(`user:${userId}`);
  }

  socket.on('note:join', ({ noteId, user }) => {
    if (typeof noteId !== 'string' || noteId.trim().length === 0 || noteId.length > 128) return;
    if (userId && user?._id && user._id !== userId) return;
    const safeNoteId = noteId.trim();
    socket.join(safeNoteId);
    socketUsers.set(socket.id, user);
    io.to(safeNoteId).emit('note:active-users', { noteId: safeNoteId, users: computeRoomUsers(safeNoteId) });
  });

  socket.on('note:leave', ({ noteId }) => {
    if (typeof noteId !== 'string' || noteId.trim().length === 0 || noteId.length > 128) return;
    const safeNoteId = noteId.trim();
    socket.leave(safeNoteId);
    io.to(safeNoteId).emit('note:active-users', { noteId: safeNoteId, users: computeRoomUsers(safeNoteId, socket.id) });
  });

  socket.on('disconnecting', () => {
    if (!socketUsers.has(socket.id)) return;
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      io.to(room).emit('note:active-users', { noteId: room, users: computeRoomUsers(room, socket.id) });
    }
  });

  socket.on('disconnect', () => {
    logger.debug('Socket disconnected', { socketId: socket.id });
    socketUsers.delete(socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);

app.get('/', (req, res) => {
  res.send('Noter Backend Running');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/ai/models', aiModelRoutes);
app.use('/api/ai/sync', authMiddleware, aiSyncRoutes);
app.use('/api/mcp', apiSensitiveLimiter, authMiddleware, mcpRoutes);
app.use('/api/graphql', apiSensitiveLimiter);
app.use('/api/graphql', (req, res, next) => {
  if (!isProduction) return next();
  if (process.env.ALLOW_GRAPHQL_INTROSPECTION === 'true') return next();
  const query = typeof req.body?.query === 'string' ? req.body.query.toLowerCase() : '';
  if (query.includes('__schema') || query.includes('__type')) {
    return res.status(403).json({ message: 'GraphQL introspection is disabled' });
  }
  return next();
});
app.use('/api/graphql', authMiddleware, createHandler({
  schema: toolSchema,
  context: (req: any) => {
    let userId: string | undefined = req?.user?.userId || req?.raw?.user?.userId;
    const token = getBearerTokenFromRequestLike(req);
    if (!userId && token === 'demo-token') userId = 'demo-user-id';
    if (!userId && token) {
      try {
        const decoded = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
        userId = getUserIdFromDecodedToken(decoded);
      } catch {}
    }
    return { userId, io: req?.app?.get('io') };
  }
}));
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

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
      logger.info('Connected to MongoDB');
    } catch (err) {
      logger.error('MongoDB connection error', { error: (err as Error)?.message || String(err) });
      logger.warn('Running without database connection (some features may fail)');
    }
  } else {
    logger.info('MONGO_URI not set, running without database connection');
  }

  server.listen(Number(port), '0.0.0.0', () => {
    logger.info(`Server running at http://0.0.0.0:${port}`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server };
