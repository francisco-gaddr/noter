import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../src/middleware/authMiddleware';
import noteRoutes from '../src/routes/notes';
import taskRoutes from '../src/routes/tasks';
import Note from '../src/models/Note';
import Task from '../src/models/Task';
import { encrypt } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(bodyParser.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);

describe('backend encryption payload validation', () => {
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
    await Task.deleteMany({});
  });

  it('rejects plaintext note payload fields', async () => {
    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: 'plain title',
        content: 'plain content',
        type: 'note',
        locked: 'false',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it('accepts encrypted note payload and stores ciphertext at rest', async () => {
    const plaintextTitle = 'Känslig anteckning';
    const plaintextContent = 'Känsligt innehåll';
    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt(plaintextTitle),
        content: encrypt(plaintextContent),
        type: encrypt('note'),
        locked: encrypt('false'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
      });
    expect(res.status).toBe(201);
    expect(String(res.body.title)).not.toContain(plaintextTitle);
    expect(String(res.body.content)).not.toContain(plaintextContent);
  });

  it('accepts versioned noter:v1 payload prefixes during validation', async () => {
    const payload = 'noter:v1:abcdefghijklmnop';
    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: payload,
        content: payload,
        type: payload,
        locked: payload,
        createdAt: payload,
        updatedAt: payload,
      });
    expect(res.status).toBe(201);
  });

  it('rejects plaintext task payload fields', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: 'plain task',
        description: 'plain description',
        completed: 'false',
        priority: 'high',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it('accepts encrypted task payload and stores ciphertext at rest', async () => {
    const plaintextTitle = 'Känslig uppgift';
    const plaintextDescription = 'Känslig uppgiftsbeskrivning';
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt(plaintextTitle),
        description: encrypt(plaintextDescription),
        completed: encrypt('false'),
        priority: encrypt('high'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        dueDate: '',
      });
    expect(res.status).toBe(201);
    expect(String(res.body.title)).not.toContain(plaintextTitle);
    expect(String(res.body.description)).not.toContain(plaintextDescription);
  });

  it('rejects invalid parentNoteId query values for tasks', async () => {
    const res = await request(app)
      .get('/api/tasks?parentNoteId=not-an-object-id')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(400);
  });
});
