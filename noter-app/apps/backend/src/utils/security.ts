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

// The signing scheme is symmetric HMAC-SHA256. Pinning it on BOTH sign and verify closes the
// algorithm-confusion class (e.g. an attacker submitting an `alg:none` or, if a public key is ever
// configured, an RS/HS-confusion token): the verifier will only ever accept an HS256 signature.
const JWT_ALGORITHM: jwt.Algorithm = 'HS256';

export const getJwtSignOptions = (): jwt.SignOptions => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  const options: jwt.SignOptions = {
    expiresIn,
    algorithm: JWT_ALGORITHM,
  };
  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;
  return options;
};

export const getJwtVerifyOptions = (): jwt.VerifyOptions => {
  const options: jwt.VerifyOptions = { algorithms: [JWT_ALGORITHM] };
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

  // First-party app origins — always allowed (these are OUR shipped clients, not a cross-origin
  // risk). The web site, the Electron desktop (`app://noter`) and the Tauri desktop (which serves
  // from `tauri://localhost` on macOS/Linux and `http://tauri.localhost` on Windows).
  const firstPartyOrigins = [
    'https://daylited.com',
    'https://www.daylited.com',
    'app://noter',
    'tauri://localhost',
    'http://tauri.localhost',
  ];

  // Dev-server origins on the developer's OWN machine. SECURITY: these must NOT be trusted in
  // production — with `credentials: true`, any process serving from `http://localhost:*` on a
  // victim's machine (a malicious local dev server, a compromised npm postinstall, a local ad)
  // could otherwise make credentialed cross-origin reads of the production API. Gated to non-prod.
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];

  const base = appEnv === 'production' ? firstPartyOrigins : [...firstPartyOrigins, ...devOrigins];
  // An explicit CORS_ORIGINS list ADDS to the first-party set (operator can add more origins) but
  // never silently re-adds the dev-localhost defaults in production.
  return Array.from(new Set([...list, ...base]));
};
