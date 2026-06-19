import { fetchWithRetry } from './httpRetry';

/**
 * Tiny, dependency-free error reporter that speaks the Sentry *envelope* ingest protocol — so it works
 * with a self-hosted GlitchTip (Sentry-API compatible) without pulling a per-platform native SDK.
 *
 * Why hand-rolled instead of @sentry/node + @sentry/react-native:
 *   - @sentry/react-native needs native modules → a native rebuild, which violates the project's hard
 *     "no EAS builds" rule. One shared reporter works identically on node, the browser and Hermes/RN.
 *   - We control EXACTLY what leaves the device — essential given the E2E/privacy model (note content,
 *     tokens and keys must never reach the monitoring server). Everything is scrubbed before send.
 *   - No new dependency; reuses the shared fetchWithRetry (per-attempt timeout + transient retry).
 *
 * Disabled (no-op) unless a valid DSN is provided, so the apps compile it in unconditionally and it
 * costs nothing until GLITCHTIP_DSN / EXPO_PUBLIC_GLITCHTIP_DSN / NEXT_PUBLIC_GLITCHTIP_DSN is set.
 */

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface EventContext {
  level?: SentryLevel;
  /** Logical operation (e.g. 'POST /api/notes/:id'). Maps to Sentry `transaction`. */
  transaction?: string;
  /** Correlate with the structured/audit logs. Sent as a tag, never a body. */
  requestId?: string;
  /** Identify the actor by OPAQUE id only — never email/username/PII. */
  userId?: string;
  tags?: Record<string, string | number | boolean | undefined>;
  /** Extra diagnostic context. Scrubbed (sensitive keys redacted, long strings truncated). */
  extra?: Record<string, unknown>;
}

export interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: SentryLevel;
  environment?: string;
  release?: string;
  server_name?: string;
  transaction?: string;
  message?: string;
  exception?: { values: Array<{ type: string; value: string; stacktrace?: { frames: SentryFrame[] } }> };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string };
}

export interface ErrorReporterConfig {
  dsn?: string | null;
  environment?: string;
  release?: string;
  /** 'node' | 'javascript' | 'react-native' — purely informational for the GlitchTip UI. */
  platform?: string;
  serverName?: string;
  /** Final hook (runs AFTER the default scrub) — return null to drop the event, or mutate + return it. */
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(err: unknown, ctx?: EventContext): Promise<string | null>;
  captureMessage(message: string, level?: SentryLevel, ctx?: EventContext): Promise<string | null>;
}

interface ParsedDsn { envelopeUrl: string; publicKey: string; dsn: string; }

/** Parse `protocol://publicKey@host[:port][/path]/projectId` into the envelope ingest URL. */
export const parseDsn = (raw: string | null | undefined): ParsedDsn | null => {
  if (!raw || typeof raw !== 'string') return null;
  // protocol :// publicKey @ host (/optional/path) / projectId
  const m = /^(https?):\/\/([^@:/]+)(?::[^@]+)?@([^/]+)(\/.*)?\/(\d+)\/?$/.exec(raw.trim());
  if (!m) return null;
  const [, protocol, publicKey, host, path, projectId] = m;
  const base = `${protocol}://${host}${path && path !== '/' ? path : ''}`;
  return {
    publicKey,
    dsn: raw.trim(),
    envelopeUrl: `${base}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`,
  };
};

/** Sensitive key fragments — any context key CONTAINING one (case-insensitive) is redacted. */
const SENSITIVE = ['password', 'token', 'secret', 'apikey', 'api_key', 'authorization', 'auth', 'cookie', 'content', 'title', 'body', 'ciphertext', 'iv', 'email', 'phone', 'jwt', 'dsn', 'privatekey', 'private_key'];
const isSensitiveKey = (k: string): boolean => { const lk = k.toLowerCase(); return SENSITIVE.some((s) => lk.includes(s)); };
const MAX_STRING = 2048;

/** Recursively redact sensitive values + truncate long strings + cap depth/breadth. Pure. */
export const scrubValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…[truncated]' : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[redacted]' : scrubValue(v, depth + 1);
  }
  return out;
};

/** Best-effort stack parse for V8 (node/Chromium) and Hermes/RN. Returns frames oldest-first (the
 *  order Sentry expects — the crashing frame last). Never throws. */
export const parseStackFrames = (stack: string | undefined): SentryFrame[] => {
  if (!stack) return [];
  const frames: SentryFrame[] = [];
  for (const line of stack.split('\n')) {
    // "    at fnName (/path/to/file.js:12:34)"  |  "    at /path/file.js:1:2"  |  "fn@/path:1:2" (Hermes)
    const m = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) || /(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (!m) continue;
    const fn = (m[1] || '').trim() || '?';
    const filename = m[2];
    frames.push({ function: fn, filename, lineno: Number(m[3]) || undefined, colno: Number(m[4]) || undefined, in_app: !filename.includes('node_modules') });
  }
  return frames.reverse();
};

/** 32-char hex event id, portable across node/browser/Hermes (no crypto.randomUUID dependency). */
const randomEventId = (): string => {
  let s = '';
  for (let i = 0; i < 32; i += 1) s += Math.floor(Math.random() * 16).toString(16);
  return s;
};

const NOOP: ErrorReporter = { enabled: false, captureException: async () => null, captureMessage: async () => null };

export const createErrorReporter = (config: ErrorReporterConfig): ErrorReporter => {
  const parsed = parseDsn(config.dsn);
  if (!parsed) return NOOP; // disabled when no/invalid DSN — zero cost
  const doFetch = config.fetchImpl;
  const platform = config.platform || 'javascript';

  const send = async (partial: Partial<SentryEvent> & { level: SentryLevel }, ctx?: EventContext): Promise<string | null> => {
    const eventId = randomEventId();
    const tags: Record<string, string> = {};
    if (ctx?.requestId) tags.request_id = ctx.requestId;
    for (const [k, v] of Object.entries(ctx?.tags || {})) if (v !== undefined) tags[k] = String(v);

    let event: SentryEvent = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform,
      environment: config.environment,
      release: config.release,
      server_name: config.serverName,
      ...partial,
      // ctx wins over the partial's default level; transaction/tags/extra/user derive from ctx.
      level: ctx?.level || partial.level,
      transaction: ctx?.transaction,
      tags: Object.keys(tags).length ? tags : undefined,
      extra: ctx?.extra ? (scrubValue(ctx.extra) as Record<string, unknown>) : undefined,
      user: ctx?.userId ? { id: ctx.userId } : undefined,
    };
    if (config.beforeSend) { const r = config.beforeSend(event); if (!r) return null; event = r; }

    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: parsed.dsn }) + '\n' +
      JSON.stringify({ type: 'event' }) + '\n' +
      JSON.stringify(event);

    try {
      await fetchWithRetry(parsed.envelopeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope,
      }, { timeoutMs: 8000, maxRetries: 1, fetchImpl: doFetch });
      return eventId;
    } catch {
      // Monitoring must never break the app or recurse — swallow.
      return null;
    }
  };

  return {
    enabled: true,
    captureException: (err, ctx) => {
      const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
      const frames = parseStackFrames(e.stack);
      return send({
        level: 'error',
        message: undefined,
        exception: { values: [{ type: e.name || 'Error', value: String(e.message || e), stacktrace: frames.length ? { frames } : undefined }] },
      }, ctx);
    },
    captureMessage: (message, level = 'info', ctx) => send({ level, message: String(message).slice(0, MAX_STRING) }, ctx),
  };
};
