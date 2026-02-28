import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import noteRoutes from '../../src/routes/notes';
import Note from '../../src/models/Note';

// Mock auth middleware
jest.mock('../../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-id' };
    next();
  },
}));

// Mock cache
jest.mock('../../src/services/cache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

const app = express();
app.use(bodyParser.json());
app.use('/api/notes', noteRoutes);

describe('Note Lock Verification', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Note.deleteMany({});
  });

  it('should return 200 OK with success: true for correct password', async () => {
    const password = 'correct-password';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const note = await Note.create({
      userId: 'test-user-id',
      title: 'Locked Note',
      content: 'Secret Content',
      password: hashedPassword,
      locked: true
    });

    const res = await request(app)
      .post(`/api/notes/${note._id}/verify-lock`)
      .send({ password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.content).toBe('Secret Content');
  });

  it('should return 200 OK with success: false for incorrect password (not 401)', async () => {
    const password = 'correct-password';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const note = await Note.create({
      userId: 'test-user-id',
      title: 'Locked Note',
      content: 'Secret Content',
      password: hashedPassword,
      locked: true
    });

    const res = await request(app)
      .post(`/api/notes/${note._id}/verify-lock`)
      .send({ password: 'wrong-password' });

    expect(res.status).toBe(200); // Changed from 401
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid password');
  });

  it('should return 404 for non-existent note', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/notes/${fakeId}/verify-lock`)
      .send({ password: 'any' });

    expect(res.status).toBe(404);
  });
});
