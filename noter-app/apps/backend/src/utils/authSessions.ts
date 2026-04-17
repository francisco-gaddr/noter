import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';

const DURATION_RE = /^(\d+)([smhd])$/i;

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export const createOpaqueToken = (bytes = 48) => randomBytes(bytes).toString('hex');

export const createTokenFamilyId = () => randomBytes(16).toString('hex');

export const getRequestIp = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]?.trim() || '';
  }
  return req.ip || '';
};

export const getRequestFingerprint = (req: Request) => ({
  userAgentHash: hashToken(String(req.headers['user-agent'] || '')),
  ipHash: hashToken(getRequestIp(req)),
});

export const durationToMs = (value: string | number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10) * 1000;
  const match = raw.match(DURATION_RE);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const amount = Number.parseInt(match[1] || '0', 10);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit];
};
