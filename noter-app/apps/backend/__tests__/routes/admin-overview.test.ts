import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import adminRoutes from '../../src/routes/admin';
import { errorHandler } from '../../src/middleware/errorMiddleware';
import User from '../../src/models/User';
import Note from '../../src/models/Note';
import Task from '../../src/models/Task';
import { getJwtSecret, getJwtSignOptions } from '../../src/utils/security';
import { encrypt } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(express.json());
app.use('/api/admin', authMiddleware, adminRoutes);
app.use(errorHandler);

const enc = (s: string) => encrypt(s);

describe('GET /api/admin/overview', () => {
  let mongoServer: MongoMemoryServer;
  let tokenA: string;
  let tokenB: string;
  let userAId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const a = await User.create({ username: 'admin-a', passwordHash: 'x' });
    const b = await User.create({ username: 'admin-b', passwordHash: 'x' });
    userAId = String(a._id);
    tokenA = jwt.sign({ userId: a._id }, getJwtSecret(), getJwtSignOptions());
    tokenB = jwt.sign({ userId: b._id }, getJwtSecret(), getJwtSignOptions());

    await Note.create({ userId: userAId, title: enc('n1'), content: enc('c1'), type: enc('note'), createdAt: enc('x'), updatedAt: enc('x') });
    await Note.create({ userId: userAId, title: enc('n2'), content: enc('c2'), type: enc('note'), createdAt: enc('x'), updatedAt: enc('x') });
    await Task.create({ userId: userAId, title: enc('t1'), createdAt: enc('x'), updatedAt: enc('x') });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/admin/overview')).status).toBe(401);
  });

  it('returns server posture + the account counts (scoped to the user)', async () => {
    const res = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.server.version).toBe('string');
    expect(res.body.server.securityLevel).toBeTruthy();
    expect(typeof res.body.server.uptimeSec).toBe('number');
    expect(res.body.counts.notes).toBe(2);
    expect(res.body.counts.tasks).toBe(1);
    expect(res.body.db.ok).toBe(true);
  });

  it('counts are isolated per user (B sees zero of A data)', async () => {
    const res = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.counts.notes).toBe(0);
    expect(res.body.counts.tasks).toBe(0);
  });
});
