/**
 * Startup environment validation.
 *
 * The backend reads a dozen env vars and historically started in a degraded mode with no alert
 * when one was missing or malformed — e.g. with NO JWT signing key configured, `signJwt` only
 * throws on the FIRST login, long after boot. This validates the environment once at startup so a
 * misconfiguration fails fast (or is at least logged loudly) instead of surfacing as a confusing
 * runtime error in production.
 *
 * Philosophy: be CONSERVATIVE about what is fatal. Only a genuinely broken, unrecoverable config
 * (no way to sign tokens at all → auth cannot work) is fatal, and only in production. Everything
 * else — a weak/placeholder secret, a missing DB/Redis URL, an unparseable number — is a loud
 * WARNING, so a borderline rule can never brick a running deploy.
 */

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER_SECRET = /(replace|change[-_]?me|your[-_]?secret|example|placeholder|^secret$|^dev$|^test$)/i;

/** Does JWT_KEYS parse to an array carrying at least one usable `current` key with a secret? */
const hasCurrentJwtKey = (raw: string | undefined): boolean => {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((k) => k && k.status === 'current' && typeof k.secret === 'string' && k.secret.length > 0);
  } catch {
    return false;
  }
};

/** A var that, when present, must parse to a finite number — otherwise it silently falls back. */
const NUMERIC_VARS = ['PORT', 'TRUST_PROXY_HOPS', 'SHUTDOWN_GRACE_MS', 'SLOW_QUERY_MS_THRESHOLD'];

/**
 * Validate the backend environment. Pure: takes the env map + whether this is production, returns
 * the errors/warnings rather than logging or exiting (the caller decides). `production` gates the
 * rules that only matter for a real deployment (missing DB/Redis, fatal-on-error).
 */
export const validateBackendEnv = (env: Env, opts: { production: boolean }): EnvReport => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- JWT signing key: the one truly fatal check ---
  const hasSigningKey = hasCurrentJwtKey(env.JWT_KEYS) || !!env.JWT_SECRET;
  if (!hasSigningKey) {
    errors.push('No JWT signing key configured (set JWT_KEYS with a "current" key, or JWT_SECRET). Token signing will fail on every login.');
  } else if (env.JWT_SECRET && !hasCurrentJwtKey(env.JWT_KEYS)) {
    // Only the legacy single-secret path is in use — sanity-check its strength.
    if (env.JWT_SECRET.length < 32) {
      warnings.push('JWT_SECRET is shorter than 32 chars — use a long random secret (or rotate via JWT_KEYS).');
    }
    if (PLACEHOLDER_SECRET.test(env.JWT_SECRET)) {
      warnings.push('JWT_SECRET looks like a placeholder/default value — replace it with a real random secret.');
    }
  }

  // --- Tamper-evident audit log ---
  if (opts.production && !env.AUDIT_HMAC_KEY) {
    warnings.push('AUDIT_HMAC_KEY is not set — the audit-log integrity chain falls back to JWT_SECRET. Set a DEDICATED key so rotating JWT_SECRET does not invalidate past audit-chain verification.');
  }

  // --- Infrastructure URLs: warnings only (the app degrades gracefully) ---
  if (opts.production) {
    if (!env.MONGO_URI) {
      warnings.push('MONGO_URI is not set in production — the server will run without a database.');
    }
    if (!env.REDIS_URL) {
      warnings.push('REDIS_URL is not set in production — rate limiting and lockout fall back to per-process memory and are NOT shared across instances (an attacker can spread attempts across pods).');
    }
  }

  // --- Numeric vars that should parse if present ---
  for (const name of NUMERIC_VARS) {
    const v = env[name];
    if (v !== undefined && v !== '' && !Number.isFinite(Number(v))) {
      warnings.push(`${name}="${v}" is not a number — the default will be used.`);
    }
  }

  return { errors, warnings };
};
