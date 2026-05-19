/**
 * Compute the delay before the next retry attempt.
 *
 * Behaviour:
 *  - If `retryAfter` is provided AND parsable, returns that (capped at maxDelayMs).
 *    Honours both numeric seconds and HTTP-date forms per RFC 9110 §10.2.3.
 *  - Otherwise: full-jitter exponential backoff per AWS Architecture Blog
 *    (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
 *    Picks a uniformly-random integer in [0, baseDelayMs * 2^attempt],
 *    capped at maxDelayMs. Full jitter outperforms equal jitter on
 *    thundering-herd recovery patterns.
 *
 * Pure function — testable without timers.
 */
export interface ComputeDelayOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  random?: () => number;
}

export const computeRetryDelay = (
  attempt: number,
  retryAfter: string | null | undefined,
  opts: ComputeDelayOptions = {},
): number => {
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      const wait = dateMs - now();
      if (wait > 0) return Math.min(wait, maxDelayMs);
    }
  }

  const exp = Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt)), maxDelayMs);
  return Math.floor(random() * exp);
};

/**
 * Classify an error/response shape as retryable.
 *  - 5xx server errors → retry
 *  - 429 rate-limited → retry (Retry-After respected)
 *  - Network-level errors (`Network request failed`, etc.) → retry
 *  - 4xx other than 429 → no retry (caller error, won't fix itself)
 */
export const isRetryableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

export const isNetworkErrorMessage = (message: string): boolean => {
  const lower = message.toLowerCase();
  return lower === 'network request failed' ||
    lower.includes('network error') ||
    lower.includes('failed to fetch');
};
