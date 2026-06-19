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

  it('accepts a note whose title/content are per-folder-sealed (v3f:) envelopes — ADR-0012', async () => {
    // A note inside a locked crypto folder: title + content are sealed under the FOLDER
    // key (v3f: envelope), while metadata (type/locked/dates) stays under the user dataKey
    // (v3:). The server stores all of it opaquely and never decrypts it. Before the v3f:
    // branch in isEncryptedPayload, this write was rejected with a 400 at the Joi gate.
    const v3fTitle = 'v3f:' + 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlYWxlZCB0aXRsZQ==';
    const v3fContent = 'v3f:' + 'c2VhbGVkIGNvbnRlbnQgdW5kZXIgdGhlIGZvbGRlciBrZXk=';
    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: v3fTitle,
        content: v3fContent,
        type: encrypt('note'),
        locked: encrypt('false'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
      });
    expect(res.status).toBe(201);
    // Stored verbatim — the v3f: envelope survives the round-trip intact (never decrypted server-side).
    expect(String(res.body.title).startsWith('v3f:')).toBe(true);
    expect(String(res.body.content).startsWith('v3f:')).toBe(true);
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
});
