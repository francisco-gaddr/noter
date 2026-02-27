import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import User from '../models/User';
import { AuthResponse } from '@repo/shared';
import { validate } from '../middleware/validate';

const router = express.Router();

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required()
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

// Register
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { username, password } = req.body;
    // Validation handled by middleware

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = new User({ username, passwordHash });
    await newUser.save();

    const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
    const token = jwt.sign({ userId: newUser._id }, JWT_SECRET, { expiresIn: '7d' });
    
    const response: AuthResponse = {
      user: {
        _id: newUser._id.toString(),
        username: newUser.username,
        createdAt: newUser.createdAt.toISOString()
      },
      token
    };

    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ message: 'Error registering user', error });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // Validation handled by middleware
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    const response: AuthResponse = {
      user: {
        _id: user._id.toString(),
        username: user.username,
        createdAt: user.createdAt.toISOString()
      },
      token
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error });
  }
});

export default router;
