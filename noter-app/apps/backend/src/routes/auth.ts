import { randomBytes } from 'crypto';
import express, { Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import User from '../models/User';
import RefreshToken from '../models/RefreshToken';
import logger from '../utils/logger';
import { AuthResponse } from '@repo/shared';
import { validate } from '../middleware/validate';
import { getJwtSecret, getJwtSignOptions, getRefreshTokenExpiresIn } from '../utils/security';
import { createOpaqueToken, createTokenFamilyId, durationToMs, getRequestFingerprint, hashToken } from '../utils/authSessions';

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
  refreshToken: Joi.string().trim().min(32).required(),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().trim().min(32).optional(),
});

const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
const REFRESH_TOKEN_EXPIRES_IN = getRefreshTokenExpiresIn();
type SessionAuthResponse = AuthResponse & { refreshToken: string };

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

    res.json(response);
  } catch (error: any) {
    logger.error('Auth login failed', { error: error?.message || String(error) });
    const message = error?.message?.includes('JWT_SECRET') ? 'Auth configuration error' : 'Error logging in';
    res.status(500).json({ message });
  }
});

router.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const presentedToken = String(req.body.refreshToken || '').trim();
    const tokenHash = hashToken(presentedToken);
    const existingToken = await RefreshToken.findOne({ tokenHash });
    if (!existingToken) {
      return res.status(401).json({ message: 'Invalid session' });
    }
    if (existingToken.revokedAt) {
      await revokeFamily(existingToken.familyId);
      return res.status(401).json({ message: 'Invalid session' });
    }
    if (existingToken.expiresAt.getTime() <= Date.now()) {
      await revokeFamily(existingToken.familyId);
      return res.status(401).json({ message: 'Session expired' });
    }

    const fingerprint = getRequestFingerprint(req);
    if (
      (existingToken.userAgentHash && existingToken.userAgentHash !== fingerprint.userAgentHash)
      || (existingToken.ipHash && existingToken.ipHash !== fingerprint.ipHash)
    ) {
      await revokeFamily(existingToken.familyId);
      return res.status(401).json({ message: 'Invalid session' });
    }

    const user = await User.findById(existingToken.userId);
    if (!user) {
      await revokeFamily(existingToken.familyId);
      return res.status(401).json({ message: 'Invalid session' });
    }

    const response = await buildAuthResponse(user, req, existingToken.familyId);
    existingToken.revokedAt = new Date();
    existingToken.replacedByTokenHash = hashToken(String(response.refreshToken || ''));
    await existingToken.save();

    res.json(response);
  } catch (error: any) {
    logger.error('Auth refresh failed', { error: error?.message || String(error) });
    res.status(500).json({ message: 'Error refreshing session' });
  }
});

router.post('/logout', validate(logoutSchema), async (req, res) => {
  try {
    const presentedToken = String(req.body.refreshToken || '').trim();
    if (!presentedToken) {
      return res.status(204).send();
    }
    const tokenHash = hashToken(presentedToken);
    const existingToken = await RefreshToken.findOne({ tokenHash });
    if (existingToken) {
      await revokeFamily(existingToken.familyId);
    }
    res.status(204).send();
  } catch (error: any) {
    logger.error('Auth logout failed', { error: error?.message || String(error) });
    res.status(500).json({ message: 'Error logging out' });
  }
});

export default router;
