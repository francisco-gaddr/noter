import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import noteRoutes from '../../src/routes/notes';
import Note from '../../src/models/Note';
import { encrypt } from '@repo/shared';

jest.setTimeout(120000);

jest.mock('../../src/services/cache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

const app = express();
app.use(bodyParser.json());
app.use((req, _res, next) => {
  (req as any).user = { userId: 'test-user-id' };
  next();
});
app.set('io', { to: () => ({ emit: () => {} }) });
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

  it('should verify lock when password is sent encrypted on create', async () => {
    const password = 'secret-123';
    const encrypted = encrypt(password);

    const createRes = await request(app)
      .post('/api/notes')
      .send({
        title: encrypt('Locked Note'),
        content: encrypt('Secret Content'),
        locked: encrypt('true'),
        type: encrypt('note'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        password: encrypted
      });

    expect(createRes.status).toBe(201);
    const noteId = createRes.body._id;

    const verifyRes = await request(app)
      .post(`/api/notes/${noteId}/verify-lock`)
      .send({ password });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
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

    expect(res.status).toBe(200);
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

  it('should unlock child note when parent project is locked and password is correct', async () => {
    const password = 'project-password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const project = await Note.create({
      userId: 'test-user-id',
      title: 'Project',
      content: '',
      type: 'project',
      password: hashedPassword,
      locked: true,
    });
    const child = await Note.create({
      userId: 'test-user-id',
      title: 'Child',
      content: 'Child Content',
      parentId: project._id,
      type: 'note',
      locked: false,
    });

    const res = await request(app)
      .post(`/api/notes/${child._id}/verify-lock`)
      .send({ password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.title).toBe('Child');
    expect(res.body.content).toBe('Child Content');
    expect(res.body.unlockedId).toBe(String(project._id));
  });
});
