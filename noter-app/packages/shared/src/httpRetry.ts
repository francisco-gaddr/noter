/**
 * Resilient HTTP for outbound provider calls (AI providers, sync, WebDAV, …).
 *
 * Two failure modes silently broke the AI chat before this existed:
 *   1. A provider accepts the TCP connection then never responds → `fetch` hangs
 *      forever and the AI tab spins with no way out.
 *   2. A transient `429 Too Many Requests` / `5xx` surfaced as a hard error even
 *      though a single short retry would have succeeded.
 *
 * `fetchWithRetry` fixes both with a per-attempt timeout (AbortController) and a
 * bounded, well-behaved retry policy: honour `Retry-After` when present, else
 * exponential backoff with jitter (RFC 9110 §10.2.3 / RFC 6585; AWS "full jitter"),
 * capped. Non-transient 4xx (400/401/403/404 — bad key, bad request) are NOT retried
 * so we never burn the user's quota or money on a request that can't succeed.
 *
 * Everything time/network/random related is injectable so the policy is unit-tested
 * deterministically with no real timers (see httpRetry.test.ts).
 */

/** A request worth retrying: request timeout, rate-limit, or a server-side error. */
export const isTransientStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

/**
 * Parse a `Retry-After` header into milliseconds. Supports both wire formats:
 * delta-seconds (`Retry-After: 30`) and an HTTP-date (`Retry-After: <http-date>`).
 * Returns null when absent/unparseable so the caller falls back to backoff.
 */
export const parseRetryAfterMs = (value: string | null | undefined, nowMs: number = Date.now()): number | null => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (raw === '') return null;
  // delta-seconds
  if (/^\d+$/.test(raw)) {
    const secs = Number(raw);
    return Number.isFinite(secs) ? Math.max(0, secs * 1000) : null;
  }
  // HTTP-date
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
};

export interface BackoffOptions {
  /** First retry's base delay before jitter (ms). */
  baseMs?: number;
  /** Hard cap on a single backoff delay (ms). */
  capMs?: number;
  /** Injected for deterministic tests; defaults to Math.random. */
  random?: () => number;
}

/**
 * Exponential backoff with "equal jitter": delay = min(cap, base·2^attempt), then
 * keep half deterministic and randomise the other half. The deterministic floor
 * means a retry is never absurdly early; the jitter desynchronises many clients.
 */
export const computeBackoffMs = (attempt: number, opts: BackoffOptions = {}): number => {
  const baseMs = opts.baseMs ?? 500;
  const capMs = opts.capMs ?? 30_000;
  const random = opts.random ?? Math.random;
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
};

const sleepCancellable = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener?.('abort', finish, { once: true });
  });

/** Thrown when a request exceeds its timeout (after exhausting retries). */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Race any promise against a wall-clock deadline. Rejects with a TimeoutError after `ms`, firing the
 * optional `onTimeout` first (best-effort) so the caller can signal cooperative cancellation to the
 * still-running work (e.g. flip an isAborted flag the agent loop polls). The underlying promise isn't
 * forcibly cancelled — JS can't — but control returns immediately so the caller can release resources.
 * Generic + dependency-free so every "could hang forever" path can reuse it instead of re-implementing.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* best-effort */ }
      reject(new TimeoutError(`operation timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
};

/** An AbortError that does not depend on DOMException (absent in Hermes/React Native). */
const makeAbortError = (reason?: unknown): Error => {
  if (reason instanceof Error) return reason;
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

export interface FetchWithRetryOptions {
  /** ms before a single attempt is aborted as a timeout. Default 60s. */
  timeoutMs?: number;
  /** Retries AFTER the first attempt (total tries = maxRetries + 1). Default 2. */
  maxRetries?: number;
  /** Caller cancellation. When it aborts, we stop immediately and never retry. */
  signal?: AbortSignal;
  /** Human label for timeout/error messages (e.g. the provider name). */
  label?: string;
  /** Base backoff delay (ms) when there is no Retry-After. Default 500. */
  backoffBaseMs?: number;
  /** Cap on a single backoff/Retry-After wait (ms). Default 30s. */
  backoffCapMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Decide whether a given response status should be retried. */
  shouldRetryStatus?: (status: number) => boolean;
}

/**
 * fetch with a per-attempt timeout and a bounded transient-retry policy. Resolves
 * with the final Response (the caller still inspects `response.ok` for non-transient
 * errors). Rejects with the caller's AbortError on cancel, or a TimeoutError when the
 * request kept timing out past `maxRetries`.
 */
export const fetchWithRetry = async (
  input: string,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> => {
  const {
    timeoutMs = 60_000,
    maxRetries = 2,
    signal: outer,
    label = 'request',
    backoffBaseMs = 500,
    backoffCapMs = 30_000,
    fetchImpl = fetch,
    now = () => Date.now(),
    random = Math.random,
    sleep = sleepCancellable,
    shouldRetryStatus = isTransientStatus,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (outer?.aborted) throw makeAbortError(outer.reason);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (outer) outer.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      clearTimeout(timer);
      outer?.removeEventListener?.('abort', onOuterAbort);

      if (response.ok || !shouldRetryStatus(response.status) || attempt === maxRetries) {
        return response;
      }
      // Transient and retries remain: honour Retry-After, else backoff.
      const retryAfter = parseRetryAfterMs(response.headers?.get?.('retry-after'), now());
      const delay = Math.min(backoffCapMs, retryAfter ?? computeBackoffMs(attempt, { baseMs: backoffBaseMs, capMs: backoffCapMs, random }));
      try { await (response as { body?: { cancel?: () => unknown } }).body?.cancel?.(); } catch { /* discard unread body */ }
      await sleep(delay, outer);
    } catch (err) {
      clearTimeout(timer);
      outer?.removeEventListener?.('abort', onOuterAbort);
      // Caller asked to cancel → propagate immediately, never retry.
      if (outer?.aborted) throw err;
      lastError = timedOut ? new TimeoutError(`${label} timed out after ${timeoutMs} ms`) : err;
      if (attempt === maxRetries) throw lastError;
      await sleep(computeBackoffMs(attempt, { baseMs: backoffBaseMs, capMs: backoffCapMs, random }), outer);
    }
  }
  // Unreachable (loop returns/throws), but keeps the type checker happy.
  throw lastError ?? new Error(`${label} failed`);
};
