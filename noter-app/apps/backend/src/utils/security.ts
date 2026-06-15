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
  const defaults = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://daylited.com',
    'https://www.daylited.com',
    // Electron desktop renderer is served over the custom `app://noter` scheme
    // (see electron-noter/main.js APP_ORIGIN). Its fetches to the API carry
    // `Origin: app://noter`; without it here CORS rejects every request and the
    // desktop app shows "Failed to fetch" on login.
    'app://noter',
  ];
  if (list.length > 0) return Array.from(new Set([...list, ...defaults]));
  if (appEnv === 'production') return defaults;
  return defaults;
};
