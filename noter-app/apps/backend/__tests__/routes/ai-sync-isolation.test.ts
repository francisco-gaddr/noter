import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import aiSyncRoutes from '../../src/routes/aiSync';
import { errorHandler } from '../../src/middleware/errorMiddleware';
import User from '../../src/models/User';
import AIConversationSync from '../../src/models/AIConversationSync';
import AIMessageSync from '../../src/models/AIMessageSync';
import { getJwtSecret, getJwtSignOptions } from '../../src/utils/security';
import { encrypt } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(express.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/ai/sync', authMiddleware, aiSyncRoutes);
app.use(errorHandler);

const iso = '2026-06-13T10:00:00.000Z';
const convo = (id: string, title: string) => ({
  id,
  titleEnc: encrypt(title),
  modelEnc: encrypt('gpt-4o-mini'),
  createdAtEnc: encrypt(iso),
  updatedAtEnc: encrypt(iso),
  updatedAt: iso,
});
const msg = (id: string, conversationId: string, content: string) => ({
  id,
  conversationId,
  roleEnc: encrypt('user'),
  contentEnc: encrypt(content),
  createdAtEnc: encrypt(iso),
  createdAt: iso,
});

describe('ai/sync cross-user isolation', () => {
  let mongoServer: MongoMemoryServer;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const a = await User.create({ username: 'alice-ai', passwordHash: 'x' });
    const b = await User.create({ username: 'bob-ai', passwordHash: 'x' });
    tokenA = jwt.sign({ userId: a._id }, getJwtSecret(), getJwtSignOptions());
    tokenB = jwt.sign({ userId: b._id }, getJwtSecret(), getJwtSignOptions());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await AIConversationSync.deleteMany({});
    await AIMessageSync.deleteMany({});
  });

  it("Bob's pull never returns Alice's pushed threads", async () => {
    const push = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ conversations: [convo('c1', 'Alice secret')], messages: [msg('m1', 'c1', 'top secret')] });
    expect(push.status).toBe(200);

    const bobPull = await request(app).get('/api/ai/sync/pull').set('Authorization', `Bearer ${tokenB}`);
    expect(bobPull.status).toBe(200);
    expect(bobPull.body.conversations).toHaveLength(0);
    expect(bobPull.body.messages).toHaveLength(0);

    // Alice still sees her own.
    const alicePull = await request(app).get('/api/ai/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    expect(alicePull.body.conversations).toHaveLength(1);
    expect(alicePull.body.messages).toHaveLength(1);
  });

  it("Bob pushing the same conversationId does not overwrite Alice's row", async () => {
    await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ conversations: [convo('shared-id', 'Alice title')] });

    // Bob upserts the SAME id — must create a separate per-user row, not clobber Alice.
    await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ conversations: [convo('shared-id', 'Bob title')] });

    const rows = await AIConversationSync.find({ conversationId: 'shared-id' });
    expect(rows).toHaveLength(2); // one per user — scoping holds

    // Alice's row is untouched (still her ciphertext).
    const alicePull = await request(app).get('/api/ai/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    expect(alicePull.body.conversations).toHaveLength(1);
    expect(alicePull.body.conversations[0].id).toBe('shared-id');
  });

  it("Bob's delete cannot remove Alice's conversation", async () => {
    await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ conversations: [convo('c9', 'Alice keep')], messages: [msg('m9', 'c9', 'keep me')] });

    await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ deletedConversationIds: ['c9'] });

    const alicePull = await request(app).get('/api/ai/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    expect(alicePull.body.conversations).toHaveLength(1);
    expect(alicePull.body.messages).toHaveLength(1);
  });
});
