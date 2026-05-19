import logger from './logger';

/**
 * Resolve the trust-proxy setting for express.
 *
 * Why this needs care: `app.set('trust proxy', N)` tells express to trust
 * the N closest hops of X-Forwarded-For. If N is too high, a client can
 * spoof their real IP by prepending fake entries. If it's 0 we trust no
 * proxies and req.ip is always the load balancer's IP.
 *
 * Source of truth: TRUST_PROXY_HOPS env var. Valid values:
 *   - integer >= 0 (number of trusted hops, conventional setting)
 *   - 'loopback' | 'linklocal' | 'uniquelocal' (named subnets)
 *   - comma-separated IP/CIDR list (per express docs)
 *   - 'false' to disable
 *
 * Default: 1 (single front-proxy, the most common topology).
 */
export const resolveTrustProxy = (raw: string | undefined): number | string | boolean => {
  if (raw === undefined || raw === '') return 1;
  const lower = raw.trim().toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  if (lower === 'true') return true;
  const asNumber = Number(lower);
  // Reject negative and impossibly-large hop counts; treat as misconfigured.
  if (Number.isFinite(asNumber) && (asNumber < 0 || asNumber > 10 || !/^\d+$/.test(lower))) {
    // Not a clean integer in range — fall through to named/cidr/warn branches.
  } else if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  if (lower === 'loopback' || lower === 'linklocal' || lower === 'uniquelocal') return lower;
  // CIDR list must contain a dot or colon (rules out bare-integer fall-through)
  if (/[./:]/.test(raw) && /^[\d./a-fA-F:,\s]+$/.test(raw)) return raw;
  logger.warn('trust-proxy: unrecognised value, defaulting to 1', { raw });
  return 1;
};

export const installTrustProxy = (app: { set: (k: string, v: unknown) => void }): void => {
  const setting = resolveTrustProxy(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', setting);
  logger.info('trust-proxy installed', { setting });
};
