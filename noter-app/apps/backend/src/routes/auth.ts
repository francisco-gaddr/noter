import { randomBytes } from 'crypto';
import express, { Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import type { Response } from 'express';
import User from '../models/User';
import RefreshToken from '../models/RefreshToken';
import logger from '../utils/logger';
import { AuthResponse } from '@repo/shared';
import { validate } from '../middleware/validate';
import { getAccessTokenExpiresIn, getJwtSecret, getJwtSignOptions, getRefreshTokenExpiresIn } from '../utils/security';
import { createOpaqueToken, createTokenFamilyId, durationToMs, getRequestFingerprint, hashToken } from '../utils/authSessions';
import { getCookieValueFromRequestLike } from '../middleware/authMiddleware';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();

const registerSchema = Joi.object({
  username: Joi.string().trim().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(128).required()
});

const loginSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().trim().min(32).optional(),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().trim().min(32).optional(),
});

const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
const ACCESS_TOKEN_EXPIRES_IN = getAccessTokenExpiresIn();
const REFRESH_TOKEN_EXPIRES_IN = getRefreshTokenExpiresIn();
type SessionAuthResponse = AuthResponse & { refreshToken: string };
const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  maxAge,
  path: '/',
});

const applySessionCookies = (res: Response, response: SessionAuthResponse) => {
  res.cookie('noter_at', response.token, cookieOptions(durationToMs(ACCESS_TOKEN_EXPIRES_IN)));
  res.cookie('noter_rt', response.refreshToken, cookieOptions(durationToMs(REFRESH_TOKEN_EXPIRES_IN)));
};

const clearSessionCookies = (res: Response) => {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
  };
  res.clearCookie('noter_at', options);
  res.clearCookie('noter_rt', options);
};

const buildAuthResponse = async (
  user: { _id: { toString(): string }; username: string; createdAt: Date },
  req: Request,
  familyId = createTokenFamilyId(),
): Promise<SessionAuthResponse> => {
  const token = jwt.sign({ userId: user._id }, getJwtSecret(), getJwtSignOptions());
  const refreshToken = createOpaqueToken();
  const fingerprint = getRequestFingerprint(req);
  await new RefreshToken({
    userId: user._id.toString(),
    familyId,
    tokenHash: hashToken(refreshToken),
    userAgentHash: fingerprint.userAgentHash,
    ipHash: fingerprint.ipHash,
    expiresAt: new Date(Date.now() + durationToMs(REFRESH_TOKEN_EXPIRES_IN)),
  }).save();

  return {
    user: {
      _id: user._id.toString(),
      username: user.username,
      createdAt: user.createdAt.toISOString(),
    },
    token,
    refreshToken,
  };
};

const revokeFamily = async (familyId: string) => {
  await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
};

// Register
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    // Validation handled by middleware

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = new User({ username, passwordHash });
    await newUser.save();

    const response = await buildAuthResponse(newUser, req);

    applySessionCookies(res, response);
    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Auth register failed', { error: error?.message || String(error) });
    const message = error?.message?.includes('JWT_SECRET') ? 'Auth configuration error' : 'Error registering user';
    res.status(500).json({ message });
  }
});

// Login
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ username });
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const response = await buildAuthResponse(user, req);

    applySessionCookies(res, response);
    res.json(response);
  } catch (error: any) {
    logger.error('Auth login failed', { error: error?.message || String(error) });
    const message = error?.message?.includes('JWT_SECRET') ? 'Auth configuration error' : 'Error logging in';
    res.status(500).json({ message });
  }
});

router.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const presentedToken = String(req.body.refreshToken || getCookieValueFromRequestLike(req, 'noter_rt') || '').trim();
    if (!presentedToken) {
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Invalid session' });
    }
    const tokenHash = hashToken(presentedToken);
    const existingToken = await RefreshToken.findOne({ tokenHash });
    if (!existingToken) {
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Invalid session' });
    }
    if (existingToken.revokedAt) {
      await revokeFamily(existingToken.familyId);
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Invalid session' });
    }
    if (existingToken.expiresAt.getTime() <= Date.now()) {
      await revokeFamily(existingToken.familyId);
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Session expired' });
    }

    const fingerprint = getRequestFingerprint(req);
    if (
      (existingToken.userAgentHash && existingToken.userAgentHash !== fingerprint.userAgentHash)
      || (existingToken.ipHash && existingToken.ipHash !== fingerprint.ipHash)
    ) {
      await revokeFamily(existingToken.familyId);
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Invalid session' });
    }

    const user = await User.findById(existingToken.userId);
    if (!user) {
      await revokeFamily(existingToken.familyId);
      clearSessionCookies(res);
      return res.status(401).json({ message: 'Invalid session' });
    }

    const response = await buildAuthResponse(user, req, existingToken.familyId);
    existingToken.revokedAt = new Date();
    existingToken.replacedByTokenHash = hashToken(String(response.refreshToken || ''));
    await existingToken.save();

    applySessionCookies(res, response);
    res.json(response);
  } catch (error: any) {
    logger.error('Auth refresh failed', { error: error?.message || String(error) });
    res.status(500).json({ message: 'Error refreshing session' });
  }
});

router.post('/logout', validate(logoutSchema), async (req, res) => {
  try {
    const presentedToken = String(req.body.refreshToken || getCookieValueFromRequestLike(req, 'noter_rt') || '').trim();
    if (!presentedToken) {
      clearSessionCookies(res);
      return res.status(204).send();
    }
    const tokenHash = hashToken(presentedToken);
    const existingToken = await RefreshToken.findOne({ tokenHash });
    if (existingToken) {
      await revokeFamily(existingToken.familyId);
    }
    clearSessionCookies(res);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Auth logout failed', { error: error?.message || String(error) });
    res.status(500).json({ message: 'Error logging out' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  const userId = (req as AuthRequest).user?.userId;
  const user = await User.findById(userId).select('_id username createdAt').lean();
  if (!user) {
    clearSessionCookies(res);
    return res.status(404).json({ message: 'User not found' });
  }
  res.json({
    _id: String(user._id),
    username: user.username,
    createdAt: new Date(user.createdAt).toISOString(),
  });
});

export default router;
