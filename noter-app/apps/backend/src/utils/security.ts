import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_DEV_CORS_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
]);

const ephemeralSecrets = new Map<string, string>();

const getAppEnv = () => String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const isProductionEnv = () => getAppEnv() === 'production';

const readTrimmedEnv = (name: string): string | undefined => {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getEphemeralSecret = (cacheKey: string) => {
  const cached = ephemeralSecrets.get(cacheKey);
  if (cached) return cached;
  const generated = randomBytes(32).toString('hex');
  ephemeralSecrets.set(cacheKey, generated);
  return generated;
};

const getOptionalOriginsFromEnv = () => {
  const raw = readTrimmedEnv('CORS_ORIGINS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const getJwtSecret = () => {
  const secret = readTrimmedEnv('JWT_SECRET');
  if (secret) return secret;
  if (isProductionEnv()) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return getEphemeralSecret('JWT_SECRET');
};

export const getJwtSignOptions = (): jwt.SignOptions => {
  const expiresIn = getAccessTokenExpiresIn() as jwt.SignOptions['expiresIn'];
  const options: jwt.SignOptions = {
    expiresIn,
  };
  const issuer = readTrimmedEnv('JWT_ISSUER');
  const audience = readTrimmedEnv('JWT_AUDIENCE');
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  return options;
};

export const getAccessTokenExpiresIn = () => {
  return readTrimmedEnv('ACCESS_TOKEN_EXPIRES_IN')
    || readTrimmedEnv('JWT_EXPIRES_IN')
    || '15m';
};

export const getRefreshTokenExpiresIn = () => {
  return readTrimmedEnv('REFRESH_TOKEN_EXPIRES_IN') || '30d';
};

export const getJwtVerifyOptions = (): jwt.VerifyOptions => {
  const options: jwt.VerifyOptions = {};
  const issuer = readTrimmedEnv('JWT_ISSUER');
  const audience = readTrimmedEnv('JWT_AUDIENCE');
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  return options;
};

export const isDemoTokenEnabled = () => {
  return readTrimmedEnv('ALLOW_DEMO_TOKEN') === 'true';
};

export const getAllowedOrigins = () => {
  const configuredOrigins = getOptionalOriginsFromEnv();
  if (isProductionEnv()) {
    if (configuredOrigins.length === 0) {
      throw new Error('CORS_ORIGINS must be set in production');
    }
    return Array.from(new Set(configuredOrigins));
  }
  return Array.from(new Set([...DEFAULT_DEV_CORS_ORIGINS, ...configuredOrigins]));
};

export const getMcpAuditMasterKey = () => {
  const secret = readTrimmedEnv('MCP_AUDIT_MASTER_KEY');
  if (secret) return secret;
  if (isProductionEnv()) {
    throw new Error('MCP_AUDIT_MASTER_KEY or MCP_AUDIT_MASTER_KEYS must be set in production');
  }
  return getEphemeralSecret('MCP_AUDIT_MASTER_KEY');
};
