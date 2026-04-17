import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../src/middleware/authMiddleware';
import noteRoutes from '../src/routes/notes';
import Note from '../src/models/Note';
import { encrypt } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
jest.setTimeout(30_000);

const app = express();
app.use(bodyParser.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/notes', authMiddleware, noteRoutes);

describe('notes lock security', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Note.deleteMany({});
  });

  it('requires password when unlocking a locked note', async () => {
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Låst projekt'),
        content: encrypt('hemligt'),
        type: encrypt('project'),
        locked: encrypt('true'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        password: encrypt('my-secret'),
      });

    expect(createRes.status).toBe(201);
    const id = createRes.body._id;

    const unlockWithoutPassword = await request(app)
      .put(`/api/notes/${id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        locked: encrypt('false'),
      });

    expect(unlockWithoutPassword.status).toBe(403);

    const unlockWithPassword = await request(app)
      .put(`/api/notes/${id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        locked: encrypt('false'),
        password: encrypt('my-secret'),
      });

    expect(unlockWithPassword.status).toBe(403);
  });
});
