import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import User from '../models/User';
import logger from '../utils/logger';
import { AuthResponse } from '@repo/shared';
import { validate } from '../middleware/validate';
import { getJwtSecret, getJwtSignOptions } from '../utils/security';
import { ConflictError, UnauthorizedError, HttpError } from '../utils/httpErrors';

const router = express.Router();

const registerSchema = Joi.object({
  username: Joi.string().trim().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(128).required()
});

const loginSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().required()
});

const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);
const DUMMY_HASH = '$2b$12$90hPdzA7y6QAYnltj7LjY.BM7rjOADfVv8BfS7kqkQxB7MlMijH7e';

// Register — typed errors flow through errorMiddleware which emits a
// consistent { message, code, requestId } shape per round-7's HttpError
// hierarchy. ConflictError → 409 with code USERNAME_TAKEN so the mobile
// client can branch on the code rather than parsing the message string.
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      throw new ConflictError('Username already exists', { code: 'USERNAME_TAKEN' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = new User({ username, passwordHash });
    await newUser.save();

    const token = jwt.sign({ userId: newUser._id }, getJwtSecret(), getJwtSignOptions());

    const response: AuthResponse = {
      user: {
        _id: newUser._id.toString(),
        username: newUser.username,
        createdAt: newUser.createdAt.toISOString()
      },
      token
    };

    res.status(201).json(response);
  } catch (error: any) {
    // Configuration errors (JWT_SECRET missing) are surfaced as 500 with a
    // safe message; the errorMiddleware logs the stack but doesn't leak it.
    if (error?.message?.includes('JWT_SECRET')) {
      return next(new HttpError(500, 'Auth configuration error', { code: 'AUTH_CONFIG' }));
    }
    next(error);
  }
});

// Login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ username });
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedError('Invalid credentials', { code: 'INVALID_CREDENTIALS' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid credentials', { code: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign({ userId: user._id }, getJwtSecret(), getJwtSignOptions());

    const response: AuthResponse = {
      user: {
        _id: user._id.toString(),
        username: user.username,
        createdAt: user.createdAt.toISOString()
      },
      token
    };

    res.json(response);
  } catch (error: any) {
    if (error?.message?.includes('JWT_SECRET')) {
      return next(new HttpError(500, 'Auth configuration error', { code: 'AUTH_CONFIG' }));
    }
    next(error);
  }
});

export default router;
