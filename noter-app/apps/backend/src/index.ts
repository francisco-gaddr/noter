import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import mongoose from 'mongoose';
import http from 'http';
import helmet from 'helmet';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import { createRateLimit } from './middleware/rateLimit';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from './utils/logger';
import noteRoutes from './routes/notes';
import taskRoutes from './routes/tasks';
import authRoutes from './routes/auth';
import aiModelRoutes from './routes/aiModels';
import calendarRoutes from './routes/calendar';
import { reconcileCalendarFeedIndexes } from './models/CalendarFeed';
import { caldavRouter, wellKnownCaldavHandler } from './caldav/server';
import markdownShareRoutes from './routes/markdownShares';
import { reconcileMarkdownShareIndexes } from './models/MarkdownShare';
import neo4jRoutes from './routes/neo4j';
import { markdavRouter } from './markdav/server';
import { registerMarkdownLive } from './markdav/live';
import aiSyncRoutes from './routes/aiSync';
import pushRoutes from './routes/push';
import { runDueBackendAgentTasks } from './services/backendAgentRunner';
import mcpRoutes from './routes/mcp';
import healthDeepRoutes from './routes/healthDeep';
import adminRoutes from './routes/admin';
import cspReportRoutes from './routes/cspReport';
import keyBundleRoutes from './routes/keyBundle';
import apiKeysRoutes from './routes/apiKeys';
import { authMiddleware, extractTenantClaims, getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorMiddleware';
import { blockSuspiciousRequestPatterns, enforceJsonApiRequests } from './middleware/requestSecurity';
import { perfHistogramMiddleware, getPerfSnapshot } from './middleware/perfHistogram';
import { serverTimingMiddleware, recordTiming } from './middleware/serverTiming';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLogMiddleware } from './middleware/requestLog';
import { readinessGate } from './middleware/readiness';
import { conditionalGet } from './middleware/etag';
import { idempotency } from './middleware/idempotency';
import { auditLog } from './middleware/auditLog';
import { sanitiseNumbersMiddleware } from './middleware/sanitiseNumbers';
import { performance } from 'node:perf_hooks';
import { ApolloServer, type ApolloServerPlugin } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { toolSchema } from './graphql/schema';
import { complexityPlugin } from './graphql/complexityPlugin';
import { depthPlugin } from './graphql/depthPlugin';
import { getAllowedOrigins, getJwtSecret, getJwtVerifyOptions, isDemoTokenEnabled } from './utils/security';
import { installMongooseDebug } from './utils/mongooseDebug';
import { installSlowQueryLogger } from './utils/slowQueryLogger';
import { installTrustProxy } from './utils/trustProxy';
import { startChangeStreamInvalidator, stopChangeStreamInvalidator } from './services/changeStreamInvalidator';
import { startInstanceHeartbeat, stopInstanceHeartbeat } from './services/instanceHeartbeat';
import { schedule as scheduleCron, start as startCron, stop as stopCron } from './services/cronScheduler';
import { installAuthRefresh } from './socket/authRefresh';
import { installGracefulShutdown, isShuttingDown } from './utils/gracefulShutdown';
import { closeRateLimitRedis } from './middleware/rateLimit';

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

installMongooseDebug();
installSlowQueryLogger();

// In production we never want mongoose to build indexes on startup — that
// stalls the boot on large collections and silently re-introduces dropped
// indexes. Use `pnpm --filter backend run db:reconcile-indexes` to apply
// index changes explicitly, and `--dry-run` in CI to detect drift.
if (process.env.NODE_ENV === 'production') {
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
}

const app = express();
const server = http.createServer(app);
const port = parseInt(process.env.PORT || '3001', 10);
const allowedOrigins = getAllowedOrigins();
const isProduction = process.env.NODE_ENV === 'production';

installTrustProxy(app);
app.disable('x-powered-by');
// requestId must run before anything that might log so correlation works
// across helmet/cors/error-handler/etc.
app.use(requestIdMiddleware);
app.use(requestLogMiddleware);
// Readiness gate runs early but AFTER request-log so we still log the 503s
// during warm-up. Before any route-specific middleware (CORS, helmet) so the
// 503 returns fast with minimal work.
app.use(readinessGate);

// CalDAV bridge — mounted EARLY, before the browser-oriented middleware (CORS,
// JSON-enforcement, mongo-sanitize). Native CalDAV clients (Tasks.org, Apple
// Reminders) send XML/text bodies and rely on a raw OPTIONS handshake + the DAV
// header; the browser middleware below would mangle or short-circuit those. The
// router does its own Basic-Auth, body parsing, and failure throttling.
app.use('/.well-known/caldav', wellKnownCaldavHandler);
// Primary mount under /api/dav — the public edge proxy already forwards /api/* to
// this backend (WebDAV verbs included), so CalDAV works without a separate edge rule.
// /dav is kept as a direct-access alias for setups that route it explicitly.
app.use('/api/dav', caldavRouter);
app.use('/dav', caldavRouter);
// Markdown WebDAV vault (the note/files twin of CalDAV). Same rationale: mounted before
// the browser middleware so WebDAV verbs + raw bodies survive. /md is a direct alias.
app.use('/api/md', markdavRouter);
app.use('/md', markdavRouter);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 && !isProduction) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  // Browsers cap maxAge: Chromium 7200s, Firefox 86400s. We pick 1h to match
  // the more conservative cap so preflight roundtrips don't dominate
  // request latency on busy clients. Combined with `vary: Origin`, this is
  // safe: a new origin still triggers a fresh preflight.
  maxAge: 3600,
  // Explicit header allow-list — narrower than the `*` we used to send by
  // default. Includes the new Idempotency-Key + X-Request-ID for the round-5/6
  // middleware to actually be reachable from the browser.
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Idempotency-Key',
    'X-Request-ID',
    'X-Correlation-ID',
    'If-None-Match',
  ],
  exposedHeaders: [
    'ETag',
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
    'Server-Timing',
    'X-Trace-Id',
    'Idempotency-Replayed',
  ],
};

// Security & Performance Middleware
//
// Explicit CSP: helmet's default policy includes 'unsafe-inline' for styles and
// allows blob: in script-src on some versions. We pin everything to 'self' and
// the upgrade-insecure-requests directive forces http→https for any subresource.
// Frame-ancestors 'none' prevents click-jacking via <iframe>.
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"], // many UI libs ship runtime-inserted styles; revisit when SSR strict-CSP is in place
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'base-uri': ["'self'"],
      'upgrade-insecure-requests': [],
      // Browsers POST violation reports here. Reporting-API uses the
      // separate report-to mechanism; we emit both for cross-browser coverage.
      'report-uri': ['/api/csp-report'],
    },
    reportOnly: false,
  },
  crossOriginEmbedderPolicy: false, // OFF — would break image hotlinking from CDN; re-enable per-route if needed
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  strictTransportSecurity: {
    maxAge: 60 * 60 * 24 * 365, // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));
app.use(cors(corsOptions));
// compression@1.8 supports brotli natively and prefers `br` over `gzip` when
// the client's Accept-Encoding allows. We tune the brotli level for a balance
// between CPU cost and payload size: level 4 is the sweet spot for dynamic
// JSON responses (cf. https://blog.cloudflare.com/results-experimenting-brotli/).
// `threshold: 1kb` skips tiny payloads where the encoding overhead exceeds the
// savings.
app.use(compression({
  threshold: 1024,
  level: 6, // gzip level (1=fastest, 9=smallest)
  brotli: {
    enabled: true,
    zlib: {
      params: {
        // BROTLI_PARAM_QUALITY = 0
        0: 4,
      },
    },
  },
} as any));
// Once SIGTERM has been received we return 503 so the load balancer can drain
// us off without surfacing 5xx to existing connections (those keep going).
app.use((_req, res, next) => {
  if (isShuttingDown()) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ message: 'Server is shutting down' });
  }
  return next();
});
app.use(perfHistogramMiddleware);
app.use(serverTimingMiddleware);
// Default body limit covers most REST + GraphQL — small. Per-route overrides
// below for endpoints that legitimately need more. ai-sync handles batches of
// notes/tasks/messages from the client, so 2mb. Everything else stays 1mb.
app.use(express.json({ limit: '1mb' }));
// Strip NaN/Infinity from parsed bodies BEFORE any route reads them.
// Mongo silently writes NaN to numeric fields → confusing equality
// behaviour; better to coerce to null at the boundary.
app.use(sanitiseNumbersMiddleware);
app.use(enforceJsonApiRequests);
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(blockSuspiciousRequestPatterns);

// Rate Limiting — Redis-backed when REDIS_URL is set (multi-pod safe),
// in-memory fallback when not (single-pod dev). Failures during a request
// transparently fall back to memory so a Redis outage cannot 5xx the API.
// Coarse anti-abuse cap. 100/15min was far too low for a normal SPA session (one
// user loading notes + tasks + ai-sync + polling easily exceeds it, and several
// devices behind one home NAT share a public IP) — it surfaced as constant
// "Too many requests". Raised to a generous ceiling; the tight limits that matter
// live on auth (20) and sensitive (40) endpoints below.
const limiter = createRateLimit({
  keyPrefix: 'global',
  points: 3000,
  durationSec: 15 * 60,
  message: 'Too many requests from this IP, please try again later.',
});

// Skip the global cap for health probes so monitoring (Uptime Kuma every 60s) and
// the apps' health polling never consume a user's request budget.
app.use((req, res, next) => {
  if (req.path === '/api/health' || req.path.startsWith('/api/health/')) return next();
  return limiter(req, res, next);
});

const authLimiter = createRateLimit({
  keyPrefix: 'auth',
  points: 20,
  durationSec: 15 * 60,
  blockDurationSec: 15 * 60,
  message: 'Too many authentication attempts, please try again later.',
});

const apiSensitiveLimiter = createRateLimit({
  keyPrefix: 'sensitive',
  // Covers /api/keys, /api/mcp, /api/graphql. The AI sidebar polls the MCP
  // dashboards under /api/mcp, so 40/10min tripped during normal use. Raised to a
  // level that tolerates polling while still capping abuse; the genuinely dangerous
  // ops (key minting, tool calls) are naturally infrequent.
  points: 300,
  durationSec: 10 * 60,
  message: 'Too many security-sensitive requests from this IP, please try again later.',
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
    // Stash the raw token so installAuthRefresh can read its `exp` claim
    // when the connection is established. We never expose this beyond
    // the socket.data field.
    (socket.data as any).initialToken = token;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  const userId = (socket.data as any).userId as string | undefined;

  // Install JWT-expiry tracking on this socket. The handshake already
  // verified the initial token; this hook arms a timer to warn the
  // client 1min before expiry via `auth:expiring`, accepts a new token
  // via the `auth:refresh` event without forcing a reconnect, and
  // disconnects 30s after expiry if no refresh arrived.
  const initialToken = (socket.data as any).initialToken as string | undefined;
  if (userId && initialToken) {
    try { installAuthRefresh(socket, initialToken, userId); } catch (err) {
      logger.warn('socket.authRefresh-install-failed', {
        sid: socket.id, error: (err as Error)?.message,
      });
    }
  }
  if (userId) {
    socket.join(`user:${userId}`);
  }

  // External Markdown sync — CRDT "Live" relay (Phase 2). Token/owner-authed per share.
  try { registerMarkdownLive(io, socket, userId); } catch (err) {
    logger.warn('markdown-live register failed', { error: (err as Error)?.message });
  }

  socket.on('note:join', ({ noteId, user }) => {
    if (typeof noteId !== 'string' || noteId.trim().length === 0 || noteId.length > 128) return;
    if (userId && user?._id && user._id !== userId) return;
    const safeNoteId = noteId.trim();
    socket.join(safeNoteId);
    socketUsers.set(socket.id, user);
    
    // Get all users in this room
    const clients = io.sockets.adapter.rooms.get(safeNoteId);
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
    io.to(safeNoteId).emit('note:active-users', { noteId: safeNoteId, users });
  });

  socket.on('note:leave', ({ noteId, user }) => {
    if (typeof noteId !== 'string' || noteId.trim().length === 0 || noteId.length > 128) return;
    const safeNoteId = noteId.trim();
    socket.leave(safeNoteId);
    // We don't remove from socketUsers yet because they might be in other rooms? 
    // Actually usually one note at a time.
    // But let's just re-calculate users in room.
    
    const clients = io.sockets.adapter.rooms.get(safeNoteId);
    const users: any[] = [];
    if (clients) {
        clients.forEach(clientId => {
            const u = socketUsers.get(clientId);
            if (u && !users.find(existing => existing._id === u._id)) {
                users.push(u);
            }
        });
    }
    io.to(safeNoteId).emit('note:active-users', { noteId: safeNoteId, users });
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

app.get('/', (req, res) => {
  res.send('Noter Backend Running');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/health/deep', healthDeepRoutes);
app.use('/api/csp-report', cspReportRoutes);

app.get('/internal/perf-snapshot', (req, res) => {
  // Auth: shared-secret header OR loopback only.
  const expected = process.env.PERF_SNAPSHOT_TOKEN;
  const provided = req.headers['x-internal-token'];
  const remote = req.ip || '';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (expected) {
    if (provided !== expected) return res.status(401).json({ message: 'unauthorized' });
  } else if (!isLoopback) {
    return res.status(401).json({ message: 'unauthorized' });
  }
  return res.json(getPerfSnapshot());
});

// Per-route body-size overrides. The auth limit is intentionally tiny so a
// malicious actor cannot wedge a 1MB JSON blob through /login and waste a
// rate-limit slot on parsing — credentials fit in well under 10kb.
const authBodyLimit = express.json({ limit: '10kb' });
const aiSyncBodyLimit = express.json({ limit: '2mb' });

// Routes
app.use('/api/auth', authLimiter, authBodyLimit, authRoutes);
app.use('/api/keys', apiSensitiveLimiter, authMiddleware, keyBundleRoutes);
app.use('/api/keys', apiSensitiveLimiter, authMiddleware, apiKeysRoutes);
app.use('/api/notes', authMiddleware, conditionalGet(), idempotency(), auditLog(), noteRoutes);
app.use('/api/tasks', authMiddleware, conditionalGet(), idempotency(), auditLog(), taskRoutes);
app.use('/api/ai/models', aiModelRoutes);
// Calendar ICS feed: GET /:token.ics is public (token-scoped); POST/PUT/DELETE are
// auth-gated per-route inside the router, so no mount-level authMiddleware here.
app.use('/api/calendar', calendarRoutes);
app.use('/api/markdown', markdownShareRoutes);
app.use('/api/ai/sync', authMiddleware, aiSyncBodyLimit, aiSyncRoutes);
app.use('/api/push', authMiddleware, pushRoutes);
app.use('/api/mcp', apiSensitiveLimiter, authMiddleware, mcpRoutes);
app.use('/api/neo4j', apiSensitiveLimiter, authMiddleware, neo4jRoutes);
app.use('/api/admin', apiSensitiveLimiter, authMiddleware, adminRoutes);
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

// Apollo Server v4 plugin: emit per-operation Server-Timing into our response
// header pipeline so the GraphQL phase has its own timing breakdown alongside
// REST routes (parsing, validation, execution).
const serverTimingPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    const phaseStarts = new Map<string, number>();
    const markStart = (phase: string) => { phaseStarts.set(phase, performance.now()); };
    const markEnd = (req: any, phase: string) => {
      const t0 = phaseStarts.get(phase);
      if (typeof t0 !== 'number') return;
      const dur = performance.now() - t0;
      if (req) recordTiming(req as any, `gql_${phase}`, dur);
    };
    return {
      async parsingDidStart(ctx) { markStart('parse'); return async () => markEnd((ctx.contextValue as any)?.req, 'parse'); },
      async validationDidStart(ctx) { markStart('validate'); return async () => markEnd((ctx.contextValue as any)?.req, 'validate'); },
      async executionDidStart(ctx) { markStart('execute'); return { async executionDidEnd() { markEnd((ctx.contextValue as any)?.req, 'execute'); } }; },
      async willSendResponse(ctx) {
        const op = ctx.operationName || ctx.operation?.operation || 'graphql';
        const t0 = phaseStarts.get('parse') ?? performance.now();
        const total = performance.now() - t0;
        recordTiming((ctx.contextValue as any)?.req, `gql_${op}`, total, 'apollo total');
      },
    };
  },
};

const apollo = new ApolloServer({
  schema: toolSchema,
  introspection: !isProduction || process.env.ALLOW_GRAPHQL_INTROSPECTION === 'true',
  // Automatic Persisted Queries reduce request body size and let us cache
  // parsed/validated AST keyed on the SHA-256 hash sent by the client.
  // The cache is in-process; for multi-pod deployments swap to a KeyValueCache
  // backed by Redis (we already have a Redis client wired up).
  persistedQueries: { ttl: 60 * 60 },
  plugins: [depthPlugin, complexityPlugin, serverTimingPlugin],
  // Mask internal errors in production, expose codes only.
  formatError: (formatted, err) => {
    if (isProduction) {
      const code = (formatted.extensions as any)?.code || 'INTERNAL';
      logger.warn('graphql.error', { code, msg: formatted.message });
      return {
        message: code === 'BAD_USER_INPUT' || code === 'UNAUTHENTICATED' ? formatted.message : 'Internal server error',
        extensions: { code },
      };
    }
    return formatted;
  },
});

// Apollo v4 requires explicit start before middleware mounting. We start it
// synchronously below and gate the route registration on completion.
const apolloReady = apollo.start();

app.use('/api/graphql', authMiddleware, async (req, res, next) => {
  await apolloReady;
  const middleware = expressMiddleware(apollo, {
    context: async ({ req: incoming }) => {
      let userId: string | undefined = (incoming as any).user?.userId;
      let tenant: ReturnType<typeof extractTenantClaims> | undefined = (incoming as any).tenant;
      const token = getBearerTokenFromRequestLike(incoming);
      if (!userId && token === 'demo-token') userId = 'demo-user-id';
      if (token && token !== 'demo-token' && (!userId || !tenant)) {
        try {
          const decoded = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
          if (!userId) userId = getUserIdFromDecodedToken(decoded);
          if (!tenant) tenant = extractTenantClaims(decoded);
        } catch { /* fall through */ }
      }
      return { userId, tenant: tenant || {}, io: (incoming as any).app?.get('io'), req: incoming };
    },
  });
  middleware(req as any, res as any, next);
});
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
      console.log('Connected to MongoDB');
      logger.info('Connected to MongoDB');
      // Migrate calendarfeeds: drop the legacy userId-unique index so per-list feeds
      // are allowed, ensure the (userId, listId) compound unique. Idempotent.
      reconcileCalendarFeedIndexes().catch((err) => {
        logger.warn('calendarfeed index reconcile failed', { error: (err as Error)?.message });
      });
      reconcileMarkdownShareIndexes().catch((err) => {
        logger.warn('markdownshare index reconcile failed', { error: (err as Error)?.message });
      });
      startChangeStreamInvalidator(io).catch((err) => {
        logger.warn('changeStream startup failed', { error: (err as Error)?.message });
      });
      startInstanceHeartbeat().catch((err) => {
        logger.warn('instance-heartbeat startup failed', { error: (err as Error)?.message });
      });

      // Register baseline cron jobs and start the scheduler. Each registered
      // job is wrapped in withLock so multi-pod deployments don't double-fire.
      try {
        scheduleCron('instances-cleanup', { kind: 'daily', hourUtc: 3, minuteUtc: 0 }, async () => {
          // Sweep stale instance-heartbeat rows (instances that haven't pinged
          // in 5 minutes are presumed dead). Best-effort.
          try {
            const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            await mongoose.connection.db?.collection('_instances').deleteMany({ lastSeen: { $lt: cutoff } });
          } catch (err) {
            logger.warn('cron.instances-cleanup failed', { error: (err as Error)?.message });
          }
        });

        // Always-on AI-agent runner: every minute, run any delegated AI tasks that
        // are due and opted into backend execution (Hermes/local sources). The Pi
        // executes them without any device open and pushes start/finish notices.
        scheduleCron('ai-agent-runner', { kind: 'interval', everyMs: 60_000, jitterMs: 5_000 }, async () => {
          try {
            await runDueBackendAgentTasks(app.get('io'));
          } catch (err) {
            logger.warn('cron.ai-agent-runner failed', { error: (err as Error)?.message });
          }
        });
      } catch (err) {
        logger.warn('cron registration failed', { error: (err as Error)?.message });
      }
      startCron();
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

  installGracefulShutdown({
    httpServer: server,
    io,
    extras: [
      { name: 'cron-scheduler', close: () => stopCron() },
      { name: 'instance-heartbeat', close: () => stopInstanceHeartbeat() },
      { name: 'change-streams', close: () => stopChangeStreamInvalidator() },
      { name: 'redis-rate-limit', close: () => closeRateLimitRedis() },
    ],
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server };
