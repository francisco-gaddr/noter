import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createHash } from 'crypto';
import { MCP_INTEGRATIONS, McpIntegrationId, McpResolvedSettings, McpUiSettings, createEmptyMcpUiSettings, decrypt, normalizeMcpUiSettings, resolveMcpSettings } from '@repo/shared';
import { appendMcpAudit, listMcpAuditForUser } from './auditStore';

type McpRuntimeServiceConfig = {
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
};

type McpRuntimeSession = {
  key: string;
  child: ChildProcessWithoutNullStreams;
  seq: number;
  pending: Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void; timeout: NodeJS.Timeout }>;
  buffer: string;
  ready: Promise<void>;
  lastUsedAt: number;
};

type McpFailureState = {
  failures: number;
  blockedUntil: number;
};

type McpToolCacheEntry = {
  tools: Set<string>;
  fetchedAt: number;
};

type McpAuditEvent = {
  at: number;
  userId: string;
  service: McpIntegrationId;
  action: 'list_tools' | 'call_tool' | 'call_tool_blocked' | 'error';
  toolName?: string;
  ok: boolean;
  message?: string;
  intentText?: string;
};

type McpJsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

const SESSION_IDLE_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const FAILURE_COOLDOWN_MS = 45_000;
const MAX_FAILURES_BEFORE_BLOCK = 3;
const TOOL_CACHE_TTL_MS = 60_000;
const MAX_AUDIT_EVENTS = 400;
const MAX_TOTAL_SESSIONS = 60;
const MAX_SESSIONS_PER_USER = 8;
const MAX_MCP_PAYLOAD_LENGTH = 220_000;
const MAX_ARGS_DEPTH = 8;
const MAX_ARRAY_ITEMS = 300;
const MAX_OBJECT_KEYS = 300;
const MAX_CALLS_PER_MINUTE = 120;
const MAX_BUFFER_LENGTH = 512 * 1024;

const sessions = new Map<string, McpRuntimeSession>();
const failureState = new Map<string, McpFailureState>();
const toolCache = new Map<string, McpToolCacheEntry>();
const auditEvents: McpAuditEvent[] = [];
const callRate = new Map<string, { count: number; resetAt: number }>();

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const uvxBin = process.platform === 'win32' ? 'uvx.cmd' : 'uvx';

const toTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const MCP_TOOL_ALLOWLIST: Record<McpIntegrationId, string[]> = {
  slack: ['slack.*', 'chat.*', 'conversations.*', 'channels.*', 'users.*'],
  googleWorkspace: ['google.*', 'gmail.*', 'drive.*', 'calendar.*', 'docs.*', 'sheets.*'],
  notion: ['notion.*', 'search', 'pages.*', 'databases.*', 'blocks.*'],
  filesystem: ['fs.*', 'filesystem.*', 'read*', 'write*', 'list*', 'search*', 'glob*', 'stat*', 'move*', 'copy*', 'delete*'],
  playwright: ['playwright.*', 'browser.*', 'page.*', 'context.*', 'navigate*', 'click*', 'fill*', 'screenshot*', 'evaluate*'],
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MCP timeout')), timeoutMs);
    promise
      .then((result) => resolve(result))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timeout));
  });

const parseAllowedPaths = (value: string) =>
  value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const parseSessionKey = (key: string) => {
  const first = key.indexOf(':');
  const second = key.indexOf(':', first + 1);
  if (first < 0 || second < 0) {
    return { userId: '', service: 'notion' as McpIntegrationId, configHash: '' };
  }
  return {
    userId: key.slice(0, first),
    service: key.slice(first + 1, second) as McpIntegrationId,
    configHash: key.slice(second + 1),
  };
};

const maskConfigHash = (configHash: string) => {
  const trimmed = toTrimmed(configHash);
  if (!trimmed) return '';
  if (trimmed.length <= 12) return `${trimmed.slice(0, 4)}***`;
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`;
};

const listSessionsByUser = (userId: string) => [...sessions.values()].filter((session) => parseSessionKey(session.key).userId === userId);

const toSessionKey = (userId: string, service: McpIntegrationId, config: McpRuntimeServiceConfig) =>
  `${userId}:${service}:${stableHash(config)}`;

const maskError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  if (!text) return 'okänt fel';
  if (text.length > 160) return `${text.slice(0, 160)}...`;
  return text;
};

const pushAudit = (event: McpAuditEvent) => {
  auditEvents.push(event);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(0, auditEvents.length - MAX_AUDIT_EVENTS);
  }
  if (process.env.NODE_ENV !== 'test' || process.env.MCP_PERSIST_AUDIT_IN_TEST === 'true') {
    appendMcpAudit(event).catch(() => {});
  }
};

const ensureRateLimit = (userId: string, service: McpIntegrationId) => {
  const now = Date.now();
  const key = `${userId}:${service}`;
  const existing = callRate.get(key);
  if (!existing || existing.resetAt <= now) {
    callRate.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (existing.count >= MAX_CALLS_PER_MINUTE) {
    throw new Error('För många MCP-anrop, försök igen om en minut');
  }
  existing.count += 1;
  callRate.set(key, existing);
};

const sanitizeArgs = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_ARGS_DEPTH) {
    throw new Error('Tool arguments är för djupt nästlade');
  }
  if (value === null) return null;
  if (typeof value === 'string') {
    if (value.length > 12_000) throw new Error('Tool arguments innehåller för lång sträng');
    if (!isValueAllowed(value)) throw new Error('Tool arguments innehåller ogiltiga tecken');
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('Tool arguments-array är för stor');
    return value.map((item) => sanitizeArgs(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_OBJECT_KEYS) throw new Error('Tool arguments-objekt har för många fält');
    const output: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('Tool arguments innehåller förbjuden nyckel');
      }
      if (key.length > 200) throw new Error('Tool arguments innehåller för lång nyckel');
      output[key] = sanitizeArgs(item, depth + 1);
    }
    return output;
  }
  throw new Error('Tool arguments innehåller ogiltig datatyp');
};

const wildcardMatch = (value: string, pattern: string) => {
  const normalizedPattern = pattern
    .replace(/read\*/gi, 'read[_.:].*')
    .replace(/write\*/gi, 'write[_.:].*')
    .replace(/list\*/gi, 'list[_.:].*')
    .replace(/search\*/gi, 'search[_.:].*')
    .replace(/glob\*/gi, 'glob[_.:].*')
    .replace(/stat\*/gi, 'stat[_.:].*')
    .replace(/move\*/gi, 'move[_.:].*')
    .replace(/copy\*/gi, 'copy[_.:].*')
    .replace(/delete\*/gi, 'delete[_.:].*')
    .replace(/navigate\*/gi, 'navigate[_.:].*')
    .replace(/click\*/gi, 'click[_.:].*')
    .replace(/fill\*/gi, 'fill[_.:].*')
    .replace(/evaluate\*/gi, 'evaluate[_.:].*')
    .replace(/screenshot\*/gi, 'screenshot[_.:].*');
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
};

const isToolAllowedByPolicy = (service: McpIntegrationId, toolName: string) => {
  const patterns = MCP_TOOL_ALLOWLIST[service] || [];
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => wildcardMatch(toolName, pattern));
};

const toBooleanString = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' ? 'true' : 'false';
};

const isAbsolutePath = (value: string) => {
  if (!value) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('\\\\')) return true;
  if (value.startsWith('/')) return true;
  return false;
};

const toMcpEnv = (resolved: McpResolvedSettings, serviceId: McpIntegrationId): McpRuntimeServiceConfig => {
  const integration = resolved[serviceId];
  if (!integration?.enabled) {
    return { enabled: false, command: '', args: [], env: {} };
  }

  if (serviceId === 'slack') {
    return {
      enabled: true,
      command: npxBin,
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: integration.fields.botToken?.value || '',
        SLACK_TEAM_ID: integration.fields.teamId?.value || '',
        SLACK_CHANNEL_IDS: integration.fields.channelIds?.value || '',
      },
    };
  }

  if (serviceId === 'googleWorkspace') {
    return {
      enabled: true,
      command: uvxBin,
      args: ['workspace-mcp', '--tool-tier', 'core'],
      env: {
        GOOGLE_OAUTH_CLIENT_ID: integration.fields.clientId?.value || '',
        GOOGLE_OAUTH_CLIENT_SECRET: integration.fields.clientSecret?.value || '',
        GOOGLE_OAUTH_REDIRECT_URI: integration.fields.redirectUri?.value || '',
        GOOGLE_OAUTH_PATH: integration.fields.oauthPath?.value || '',
      },
    };
  }

  if (serviceId === 'notion') {
    return {
      enabled: true,
      command: npxBin,
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {
        NOTION_TOKEN: integration.fields.apiToken?.value || '',
      },
    };
  }

  if (serviceId === 'filesystem') {
    const allowed = parseAllowedPaths(integration.fields.allowedPaths?.value || '');
    return {
      enabled: true,
      command: npxBin,
      args: ['-y', '@modelcontextprotocol/server-filesystem', ...allowed],
      env: {},
    };
  }

  return {
    enabled: true,
    command: npxBin,
    args: ['-y', '@playwright/mcp@latest'],
    env: {
      PLAYWRIGHT_BROWSER: integration.fields.browser?.value || '',
      PLAYWRIGHT_HEADLESS: toBooleanString(integration.fields.headless?.value || ''),
      PLAYWRIGHT_CHANNEL: integration.fields.channel?.value || '',
    },
  };
};

const isValueAllowed = (value: string) => !value.includes('\u0000');

const validateFilesystemArgs = (config: McpRuntimeServiceConfig) => {
  const paths = config.args.slice(2).map((item) => item.trim()).filter(Boolean);
  if (paths.length === 0) {
    throw new Error('Filesystem MCP kräver minst en allowlist-path');
  }
  if (paths.length > 24) {
    throw new Error('För många allowlist-paths för filesystem MCP');
  }
  for (const path of paths) {
    if (!isAbsolutePath(path)) {
      throw new Error('Filesystem allowlist måste innehålla absoluta paths');
    }
    if (path.length > 320) {
      throw new Error('Filesystem allowlist-path är för lång');
    }
  }
};

const ensureRequiredEnv = (service: McpIntegrationId, config: McpRuntimeServiceConfig) => {
  const requiredKeysByService: Record<McpIntegrationId, string[]> = {
    slack: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    googleWorkspace: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    notion: ['NOTION_TOKEN'],
    filesystem: [],
    playwright: [],
  };
  const required = requiredKeysByService[service];
  for (const key of required) {
    const value = toTrimmed(config.env[key]);
    if (!value) {
      throw new Error(`Saknar obligatorisk konfiguration för ${service}: ${key}`);
    }
  }
  if (service === 'filesystem') {
    validateFilesystemArgs(config);
  }
};

const sanitizeRuntimeConfig = (config: McpRuntimeServiceConfig) => {
  if (!config.enabled) return config;
  if (!config.command || !isValueAllowed(config.command)) {
    throw new Error('Ogiltigt MCP-kommando');
  }
  if (config.args.some((arg) => !isValueAllowed(arg))) {
    throw new Error('Ogiltiga MCP-argument');
  }
  const envEntries = Object.entries(config.env).filter(([, value]) => toTrimmed(value).length > 0);
  const safeEnv: Record<string, string> = {};
  for (const [key, value] of envEntries) {
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    if (!isValueAllowed(value)) continue;
    safeEnv[key] = value;
  }
  return { ...config, env: safeEnv };
};

export const decodeMcpUiSettingsPayload = (payload: unknown) => {
  if (!payload) return createEmptyMcpUiSettings();
  if (typeof payload === 'object') return normalizeMcpUiSettings(payload);
  const raw = String(payload);
  if (raw.length > MAX_MCP_PAYLOAD_LENGTH) {
    throw new Error('MCP payload är för stor');
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}
  if (!parsed) {
    try {
      const decrypted = decrypt(raw);
      parsed = decrypted ? JSON.parse(decrypted) : null;
    } catch {}
  }
  return normalizeMcpUiSettings(parsed);
};

export const buildResolvedMcpRuntimeConfig = (payload: unknown, env: Record<string, string | undefined>) => {
  const uiSettings = decodeMcpUiSettingsPayload(payload);
  const resolved = resolveMcpSettings(uiSettings, env);
  const result = {} as Record<McpIntegrationId, McpRuntimeServiceConfig>;
  for (const integration of MCP_INTEGRATIONS) {
    const config = sanitizeRuntimeConfig(toMcpEnv(resolved, integration.id));
    if (config.enabled) {
      ensureRequiredEnv(integration.id, config);
    }
    result[integration.id] = config;
  }
  return result;
};

const writeRequest = (session: McpRuntimeSession, request: McpJsonRpcRequest) => {
  session.child.stdin.write(`${JSON.stringify(request)}\n`);
};

const rejectPending = (session: McpRuntimeSession, reason: unknown) => {
  for (const [, pending] of session.pending.entries()) {
    clearTimeout(pending.timeout);
    pending.reject(reason);
  }
  session.pending.clear();
};

const closeSession = (session: McpRuntimeSession) => {
  rejectPending(session, new Error('MCP session closed'));
  session.child.kill();
  toolCache.delete(session.key);
  sessions.delete(session.key);
};

const onData = (session: McpRuntimeSession, chunk: Buffer) => {
  session.buffer += chunk.toString('utf8');
  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    rejectPending(session, new Error('MCP output exceeded buffer limit'));
    closeSession(session);
    return;
  }
  const lines = session.buffer.split(/\r?\n/);
  session.buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed?.id !== 'number') continue;
    const pending = session.pending.get(parsed.id);
    if (!pending) continue;
    clearTimeout(pending.timeout);
    session.pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new Error(parsed.error?.message || 'MCP error'));
    } else {
      pending.resolve(parsed.result);
    }
  }
};

const request = (session: McpRuntimeSession, method: string, params: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const id = ++session.seq;
  const requestPayload: McpJsonRpcRequest = { jsonrpc: '2.0', id, method, params };
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`MCP timeout (${method})`));
    }, timeoutMs);
    session.pending.set(id, { resolve, reject, timeout });
    writeRequest(session, requestPayload);
  });
};

const notify = (session: McpRuntimeSession, method: string, params: Record<string, unknown> = {}) => {
  const payload: McpJsonRpcRequest = { jsonrpc: '2.0', method, params };
  writeRequest(session, payload);
};

const initSession = async (session: McpRuntimeSession) => {
  await request(session, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'noter-backend', version: '1.0.0' },
  });
  notify(session, 'notifications/initialized');
};

const createScopedEnv = (env: Record<string, string>) => {
  const scoped: Record<string, string> = {};
  ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'SystemRoot', 'ComSpec'].forEach((key) => {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      scoped[key] = value;
    }
  });
  return { ...scoped, ...env };
};

const createSession = (key: string, config: McpRuntimeServiceConfig): McpRuntimeSession => {
  const child = spawn(config.command, config.args, {
    stdio: 'pipe',
    env: createScopedEnv(config.env),
    windowsHide: true,
    shell: false,
  });
  const session: McpRuntimeSession = {
    key,
    child,
    seq: 0,
    pending: new Map(),
    buffer: '',
    ready: Promise.resolve(),
    lastUsedAt: Date.now(),
  };
  child.stdout.on('data', (chunk) => onData(session, chunk));
  child.stderr.on('data', () => {});
  child.once('error', (error) => {
    rejectPending(session, error);
    sessions.delete(key);
  });
  child.once('exit', () => {
    rejectPending(session, new Error('MCP process exited'));
    sessions.delete(key);
  });
  session.ready = withTimeout(initSession(session), REQUEST_TIMEOUT_MS);
  return session;
};

export const isExplicitServiceIntent = (service: McpIntegrationId, intentText?: string) => {
  const text = toTrimmed(intentText).toLowerCase();
  if (!text) return false;
  const keywords: Record<McpIntegrationId, string[]> = {
    notion: ['notion'],
    googleWorkspace: ['google', 'gmail', 'drive', 'gdrive', 'calendar', 'gcalendar', 'google calendar', 'kalender'],
    slack: ['slack'],
    filesystem: ['filesystem', 'filsystem', 'lokal fil', 'lokala filer', 'mapp', 'katalog'],
    playwright: ['playwright', 'browser', 'webbläsare'],
  };
  const verbs = ['öppna', 'använd', 'kör', 'lista', 'hämta', 'skapa', 'uppdatera', 'ta bort', 'lägg till', 'skicka', 'use', 'call', 'run'];
  const hasKeyword = keywords[service].some((keyword) => text.includes(keyword));
  const hasVerb = verbs.some((verb) => text.includes(verb));
  return hasKeyword && hasVerb;
};

const extractToolNames = (result: any) => {
  const list = Array.isArray(result?.tools) ? result.tools : [];
  return list
    .map((item: any) => (typeof item?.name === 'string' ? item.name.trim() : ''))
    .filter(Boolean);
};

const cacheTools = (sessionKey: string, result: any) => {
  const toolNames = extractToolNames(result);
  if (toolNames.length === 0) return;
  toolCache.set(sessionKey, { tools: new Set(toolNames), fetchedAt: Date.now() });
};

const getCachedTools = (sessionKey: string) => {
  const entry = toolCache.get(sessionKey);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TOOL_CACHE_TTL_MS) {
    toolCache.delete(sessionKey);
    return null;
  }
  return entry;
};

const markFailure = (failureKey: string) => {
  const prev = failureState.get(failureKey) || { failures: 0, blockedUntil: 0 };
  const failures = prev.failures + 1;
  const blockedUntil = failures >= MAX_FAILURES_BEFORE_BLOCK ? Date.now() + FAILURE_COOLDOWN_MS : prev.blockedUntil;
  failureState.set(failureKey, { failures, blockedUntil });
};

const clearFailure = (failureKey: string) => {
  failureState.delete(failureKey);
};

const ensureNotBlocked = (failureKey: string) => {
  const state = failureState.get(failureKey);
  if (!state) return;
  if (state.blockedUntil > Date.now()) {
    throw new Error('MCP temporärt blockerad efter upprepade fel');
  }
  if (state.blockedUntil <= Date.now()) {
    failureState.delete(failureKey);
  }
};

const cleanupIdleSessions = () => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.lastUsedAt > SESSION_IDLE_TTL_MS) {
      closeSession(session);
    }
  }
};

setInterval(cleanupIdleSessions, 20_000).unref();

const getSession = async (
  userId: string,
  service: McpIntegrationId,
  config: McpRuntimeServiceConfig
) => {
  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) closeSession(oldest);
  }
  const userSessions = listSessionsByUser(userId);
  if (userSessions.length >= MAX_SESSIONS_PER_USER) {
    const oldestForUser = userSessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldestForUser) closeSession(oldestForUser);
  }
  const key = toSessionKey(userId, service, config);
  const oldSessions = [...sessions.values()].filter((session) => session.key.startsWith(`${userId}:${service}:`) && session.key !== key);
  for (const oldSession of oldSessions) {
    closeSession(oldSession);
  }
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    await existing.ready;
    return existing;
  }
  const created = createSession(key, config);
  sessions.set(key, created);
  await created.ready;
  created.lastUsedAt = Date.now();
  return created;
};

const ensureServiceEnabled = (config: McpRuntimeServiceConfig, service: McpIntegrationId) => {
  if (!config.enabled) {
    throw new Error(`MCP-tjänsten ${service} är inte aktiverad`);
  }
};

const validateToolCall = (toolName: string, args: Record<string, unknown>) => {
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(toolName)) {
    throw new Error('Ogiltigt toolName');
  }
  const serialized = JSON.stringify(args || {});
  if (serialized.length > 24_000) {
    throw new Error('Tool arguments är för stora');
  }
};

const ensureAllowedToolName = async (
  userId: string,
  service: McpIntegrationId,
  config: McpRuntimeServiceConfig,
  toolName: string
) => {
  if (!isToolAllowedByPolicy(service, toolName)) {
    throw new Error(`Tool ${toolName} är inte tillåten för ${service}`);
  }
  const key = toSessionKey(userId, service, config);
  let cached = getCachedTools(key);
  if (!cached) {
    const session = await getSession(userId, service, config);
    const listResult = await request(session, 'tools/list', {});
    cacheTools(key, listResult);
    cached = getCachedTools(key);
  }
  if (!cached || !cached.tools.has(toolName)) {
    throw new Error(`Tool ${toolName} finns inte i aktiv MCP-tool-lista för ${service}`);
  }
};

export const mcpRuntime = {
  async listTools(params: {
    userId: string;
    service: McpIntegrationId;
    mcpUiSettingsPayload?: unknown;
  }) {
    const configMap = buildResolvedMcpRuntimeConfig(params.mcpUiSettingsPayload, process.env as Record<string, string | undefined>);
    const serviceConfig = configMap[params.service];
    ensureServiceEnabled(serviceConfig, params.service);
    ensureRateLimit(params.userId, params.service);
    const failureKey = `${params.userId}:${params.service}`;
    ensureNotBlocked(failureKey);
    try {
      const session = await getSession(params.userId, params.service, serviceConfig);
      const result = await request(session, 'tools/list', {});
      cacheTools(session.key, result);
      clearFailure(failureKey);
      pushAudit({
        at: Date.now(),
        userId: params.userId,
        service: params.service,
        action: 'list_tools',
        ok: true,
      });
      return result;
    } catch (error) {
      markFailure(failureKey);
      pushAudit({
        at: Date.now(),
        userId: params.userId,
        service: params.service,
        action: 'error',
        ok: false,
        message: maskError(error),
      });
      throw error;
    }
  },

  async callTool(params: {
    userId: string;
    service: McpIntegrationId;
    toolName: string;
    args: Record<string, unknown>;
    intentText?: string;
    mcpUiSettingsPayload?: unknown;
  }) {
    if (!isExplicitServiceIntent(params.service, params.intentText)) {
      pushAudit({
        at: Date.now(),
        userId: params.userId,
        service: params.service,
        action: 'call_tool_blocked',
        ok: false,
        toolName: params.toolName,
        message: 'explicit tjänsteintention saknas',
        intentText: params.intentText,
      });
      throw new Error(`Explicit nämnning av ${params.service} krävs innan MCP-anrop`);
    }
    validateToolCall(params.toolName, params.args || {});
    const configMap = buildResolvedMcpRuntimeConfig(params.mcpUiSettingsPayload, process.env as Record<string, string | undefined>);
    const serviceConfig = configMap[params.service];
    ensureServiceEnabled(serviceConfig, params.service);
    ensureRateLimit(params.userId, params.service);
    const sanitizedArgs = sanitizeArgs(params.args || {}) as Record<string, unknown>;
    await ensureAllowedToolName(params.userId, params.service, serviceConfig, params.toolName);
    const failureKey = `${params.userId}:${params.service}`;
    ensureNotBlocked(failureKey);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await getSession(params.userId, params.service, serviceConfig);
        const result = await request(session, 'tools/call', {
          name: params.toolName,
          arguments: sanitizedArgs,
        });
        clearFailure(failureKey);
        pushAudit({
          at: Date.now(),
          userId: params.userId,
          service: params.service,
          action: 'call_tool',
          toolName: params.toolName,
          ok: true,
          intentText: params.intentText,
        });
        return result;
      } catch (error) {
        lastError = error;
        markFailure(failureKey);
        pushAudit({
          at: Date.now(),
          userId: params.userId,
          service: params.service,
          action: 'error',
          toolName: params.toolName,
          ok: false,
          message: maskError(error),
          intentText: params.intentText,
        });
        const existingSessions = [...sessions.values()].filter((session) => session.key.startsWith(`${params.userId}:${params.service}:`));
        for (const item of existingSessions) closeSession(item);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('MCP call failed');
  },

  health(params?: { userId?: string; includeAudit?: boolean }) {
    const userFilter = toTrimmed(params?.userId);
    const includeAudit = Boolean(params?.includeAudit);
    const sessionRows = [...sessions.values()]
      .map((session) => {
        const parts = parseSessionKey(session.key);
        return {
          userId: parts.userId,
          service: parts.service,
          configHash: includeAudit ? parts.configHash : maskConfigHash(parts.configHash),
          lastUsedAt: session.lastUsedAt,
          pendingRequests: session.pending.size,
        };
      })
      .filter((row) => (userFilter ? row.userId === userFilter : true));
    const failureRows = [...failureState.entries()]
      .map(([failureKey, state]) => {
        const first = failureKey.indexOf(':');
        const userId = first >= 0 ? failureKey.slice(0, first) : '';
        const service = (first >= 0 ? failureKey.slice(first + 1) : '') as McpIntegrationId;
        return {
          userId,
          service,
          failures: state.failures,
          blockedUntil: state.blockedUntil,
          isBlocked: state.blockedUntil > Date.now(),
        };
      })
      .filter((row) => (userFilter ? row.userId === userFilter : true));
    return {
      now: Date.now(),
      sessionCount: sessionRows.length,
      sessions: sessionRows,
      failures: failureRows,
      recentAudit: includeAudit
        ? auditEvents
            .filter((event) => (userFilter ? event.userId === userFilter : true))
            .slice(-40)
        : [],
    };
  },

  async dashboard(params: { userId: string; limit?: number }) {
    const userId = toTrimmed(params.userId);
    if (!userId) {
      throw new Error('userId krävs');
    }
    const limit = typeof params.limit === 'number' ? params.limit : 50;
    const persistedAudit = await listMcpAuditForUser({ userId, limit });
    const runtimeHealth = this.health({ userId, includeAudit: true });
    return {
      now: Date.now(),
      userId,
      persistedAudit,
      runtimeHealth,
    };
  },
};

export const mcpRuntimeInternals = {
  isToolAllowedByPolicy,
  sanitizeArgs,
  reset() {
    for (const session of sessions.values()) {
      try {
        session.child.kill();
      } catch {}
    }
    sessions.clear();
    failureState.clear();
    callRate.clear();
    toolCache.clear();
    auditEvents.splice(0, auditEvents.length);
  },
};
