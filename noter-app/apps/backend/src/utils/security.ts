import jwt from 'jsonwebtoken';

const appEnv = process.env.NODE_ENV || 'development';

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim()) return secret.trim();
  if (appEnv === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'dev-insecure-secret-change-me';
};

export const getJwtSignOptions = (): jwt.SignOptions => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  const options: jwt.SignOptions = {
    expiresIn,
  };
  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;
  return options;
};

export const getJwtVerifyOptions = (): jwt.VerifyOptions => {
  const options: jwt.VerifyOptions = {};
  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;
  return options;
};

export const isDemoTokenEnabled = () => {
  const fromEnv = process.env.ALLOW_DEMO_TOKEN;
  if (fromEnv === 'true') return true;
  if (fromEnv === 'false') return false;
  return appEnv !== 'production';
};

export const getAllowedOrigins = () => {
  const raw = process.env.CORS_ORIGINS || '';
  const list = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  if (appEnv === 'production') return [];
  return ['http://localhost:3000', 'http://localhost:8081', 'http://127.0.0.1:3000'];
};
