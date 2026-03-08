import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import User from '../models/User';
import logger from '../utils/logger';
import { AuthResponse } from '@repo/shared';
import { validate } from '../middleware/validate';
import { getJwtSecret, getJwtSignOptions } from '../utils/security';

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
    logger.error('Auth login failed', { error: error?.message || String(error) });
    const message = error?.message?.includes('JWT_SECRET') ? 'Auth configuration error' : 'Error logging in';
    res.status(500).json({ message });
  }
});

export default router;
