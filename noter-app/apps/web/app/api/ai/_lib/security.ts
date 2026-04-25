import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const getHeaderValue = (value: string | null) => (typeof value === 'string' ? value.trim() : '');

const getRequestToken = (req: NextRequest) => {
  const authHeader = getHeaderValue(req.headers.get('authorization'));
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  const cookieToken = getHeaderValue(req.cookies.get('noter_at')?.value || null);
  return cookieToken;
};

export const authenticateAiRequest = (req: NextRequest) => {
  const token = getRequestToken(req);
  if (!token) {
    throw new Error('Unauthorized');
  }
  if (token === 'demo-token' && process.env.NODE_ENV !== 'production') {
    return { userId: 'demo-user-id', token };
  }
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  const userId = [decoded.userId, decoded.id, decoded._id, decoded.sub].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return { userId, token };
};

export const resolveBackendApiBaseUrl = (req: NextRequest) => {
  const explicit = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const origin = new URL(req.url).origin;
  return `${origin.replace(/\/$/, '')}/api`;
};

export const buildBackendProxyHeaders = (req: NextRequest) => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
  };
  const authorization = getHeaderValue(req.headers.get('authorization'));
  const cookie = getHeaderValue(req.headers.get('cookie'));
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
};

export const resolveAllowedModelPath = (requestedPath: string) => {
  const raw = String(requestedPath || '').trim().replace(/^\/+/, '');
  if (!raw) {
    throw new Error('Model path required');
  }
  const baseDir = path.resolve(process.env.NOTER_WEB_AI_MODEL_DIR || path.join(process.cwd(), 'models'));
  const resolved = path.resolve(baseDir, raw.replace(/^models\//, ''));
  const relative = path.relative(baseDir, resolved);
  if (!resolved.startsWith(baseDir) || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Model path is not allowed');
  }
  const realBaseDir = fs.realpathSync(baseDir);
  const realResolved = fs.realpathSync(resolved);
  if (!realResolved.startsWith(realBaseDir)) {
    throw new Error('Model path escapes allowed directory');
  }
  return realResolved;
};
