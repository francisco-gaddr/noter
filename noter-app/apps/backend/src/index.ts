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
import cache from './services/cache';
import noteRoutes from './routes/notes';
import taskRoutes from './routes/tasks';
import authRoutes from './routes/auth';
import aiModelRoutes from './routes/aiModels';
import aiSyncRoutes from './routes/aiSync';
import mcpRoutes from './routes/mcp';
import { authMiddleware, getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorMiddleware';
import { blockSuspiciousRequestPatterns, enforceJsonApiRequests } from './middleware/requestSecurity';
import { createRequestContextMiddleware } from './middleware/requestContext';
import { createHandler } from 'graphql-http/lib/use/express';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import { toolSchema } from './graphql/schema';
import { graphqlOperationLimitRule } from './graphql/validation';
import { assertSecureStartupConfig, getAllowedOrigins, getJwtSecret, getJwtVerifyOptions, getTrustProxySetting, isDemoTokenEnabled } from './utils/security';
import { buildHealthResponse, buildReadyResponse } from './services/runtimeHealth';
import { createRedisRateLimitStore } from './services/rateLimitStore';
import { createSocketConnectionAttemptLimiter } from './services/socketConnectionAttempts';

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
let isReady = false;
let isShuttingDown = false;
let serverStarted = false;
let shutdownPromise: Promise<void> | null = null;

assertSecureStartupConfig();

app.set('trust proxy', getTrustProxySetting());
app.disable('x-powered-by');

app.use(createRequestContextMiddleware(logger));

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
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  frameguard: { action: 'deny' },
  hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(enforceJsonApiRequests);
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(blockSuspiciousRequestPatterns);

// Rate Limiting
const globalRateLimitStore = createRedisRateLimitStore('rl:global');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  ...(globalRateLimitStore ? { store: globalRateLimitStore } : {}),
  passOnStoreError: true,
});

// Apply rate limiting to all requests
app.use(limiter);

const authRateLimitStore = createRedisRateLimitStore('rl:auth');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts, please try again later.',
  ...(authRateLimitStore ? { store: authRateLimitStore } : {}),
  passOnStoreError: false,
});

const sensitiveRateLimitStore = createRedisRateLimitStore('rl:sensitive');
const apiSensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many security-sensitive requests from this IP, please try again later.',
  ...(sensitiveRateLimitStore ? { store: sensitiveRateLimitStore } : {}),
  passOnStoreError: false,
});

const socketConnectRateLimitStore = createRedisRateLimitStore('rl:socket-connect');
if (socketConnectRateLimitStore?.init) {
  socketConnectRateLimitStore.init({ windowMs: 60_000 } as any);
}
const socketAttemptLimiter = createSocketConnectionAttemptLimiter({
  windowMs: 60_000,
  max: 45,
  increment: socketConnectRateLimitStore
    ? async (key) => socketConnectRateLimitStore.increment(key)
    : undefined,
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length === 0 && !isProduction ? true : allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  maxHttpBufferSize: 1e6,
  perMessageDeflate: { threshold: 1024 },
  pingInterval: 25000,
  pingTimeout: 20000
});

// Track users in rooms
// socketId -> User info
const socketUsers = new Map<string, any>();

const getSocketIp = (socket: any) => {
  const forwarded = socket?.handshake?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]?.trim() || '';
  }
  return String(socket?.handshake?.address || '');
};

io.use(async (socket, next) => {
  const ip = getSocketIp(socket) || 'unknown';
  const attempt = await socketAttemptLimiter.check(ip);
  if (!attempt.allowed) {
    next(new Error('Too many connection attempts'));
    return;
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
    if (!userId) return;
    const safeNoteId = noteId.trim();
    const safeUsername = typeof user?.username === 'string' && user.username.trim().length > 0
      ? user.username.trim().slice(0, 128)
      : undefined;
    socket.join(safeNoteId);
    socketUsers.set(socket.id, { _id: userId, ...(safeUsername ? { username: safeUsername } : {}) });
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

app.get('/', (_req, res) => {
  res.send('Noter Backend Running');
});

app.get('/api/health', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = await cache.ping().catch(() => false);
  const response = buildHealthResponse({ mongoOk, redisOk, isReady, isShuttingDown });
  res.status(response.statusCode).json(response.body);
});

app.get('/api/ready', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = await cache.ping().catch(() => false);
  const response = buildReadyResponse({ mongoOk, redisOk, isReady, isShuttingDown });
  res.status(response.statusCode).json(response.body);
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/ai/models', apiSensitiveLimiter, aiModelRoutes);
app.use('/api/ai/sync', authMiddleware, aiSyncRoutes);
app.use('/api/mcp', apiSensitiveLimiter, authMiddleware, mcpRoutes);
app.use('/api/graphql', apiSensitiveLimiter);
const graphqlHandler = createHandler({
  schema: toolSchema,
  validationRules: [
    graphqlOperationLimitRule,
    ...(isProduction && process.env.ALLOW_GRAPHQL_INTROSPECTION !== 'true'
      ? [NoSchemaIntrospectionCustomRule]
      : []),
  ],
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
} as any);
app.use('/api/graphql', authMiddleware, graphqlHandler);
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Error Handler
app.use(errorHandler);

// MongoDB connection
const mongoUri = process.env.MONGO_URI;

const shutdown = async (signal: string) => {
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }
  isShuttingDown = true;
  isReady = false;
  shutdownPromise = (async () => {
    logger.info('Shutdown initiated', { signal });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 10_000);
    });
    await Promise.race([
      (async () => {
        await new Promise<void>((resolve) => {
          if (!serverStarted) {
            resolve();
            return;
          }
          server.close(() => resolve());
        });
        await new Promise<void>((resolve) => io.close(() => resolve()));
        await mongoose.disconnect().catch(() => undefined);
        await cache.close().catch(() => undefined);
      })(),
      timeout,
    ]);
    logger.info('Shutdown completed', { signal });
  })();
  await shutdownPromise;
};

const startServer = async () => {
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        maxPoolSize: 20,
        minPoolSize: 2,
        maxIdleTimeMS: 60_000,
        bufferCommands: false, // Fail immediately if not connected
      });
      logger.info('Connected to MongoDB');
    } catch (err) {
      logger.error('MongoDB connection error', { error: (err as Error)?.message || String(err) });
      logger.warn('Running without database connection (some features may fail)');
    }
  } else {
    logger.warn('MONGO_URI not set, running without database connection');
  }

  server.listen(Number(port), '0.0.0.0', () => {
    serverStarted = true;
    isReady = true;
    logger.info(`Server running at http://0.0.0.0:${port}`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  startServer();
}

export { app, server, shutdown };
