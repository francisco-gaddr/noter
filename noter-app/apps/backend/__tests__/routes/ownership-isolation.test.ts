import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import noteRoutes from '../../src/routes/notes';
import taskRoutes from '../../src/routes/tasks';
import { errorHandler } from '../../src/middleware/errorMiddleware';
import User from '../../src/models/User';
import Note from '../../src/models/Note';
import Task from '../../src/models/Task';
import { getJwtSecret, getJwtSignOptions } from '../../src/utils/security';
import { encrypt } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(express.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use(errorHandler);

const enc = (s: string) => encrypt(s);
const notePayload = (title: string) => ({
  title: enc(title),
  content: enc('body'),
  type: enc('note'),
  locked: enc('false'),
  createdAt: enc(new Date().toISOString()),
  updatedAt: enc(new Date().toISOString()),
});
const taskPayload = (title: string) => ({
  title: enc(title),
  description: enc('desc'),
  completed: enc('false'),
  priority: enc('medium'),
  createdAt: enc(new Date().toISOString()),
  updatedAt: enc(new Date().toISOString()),
});

describe('ownership isolation (IDOR guards) + CRUD round-trip', () => {
  let mongoServer: MongoMemoryServer;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const userA = await User.create({ username: 'alice', passwordHash: 'x' });
    const userB = await User.create({ username: 'bob', passwordHash: 'x' });
    tokenA = jwt.sign({ userId: userA._id }, getJwtSecret(), getJwtSignOptions());
    tokenB = jwt.sign({ userId: userB._id }, getJwtSecret(), getJwtSignOptions());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Note.deleteMany({});
    await Task.deleteMany({});
  });

  it('owner can create → read → update → delete a note (round-trip)', async () => {
    const created = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(notePayload('mine'));
    expect(created.status).toBe(201);
    const id = created.body._id;

    const got = await request(app).get(`/api/notes/${id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(got.status).toBe(200);
    expect(got.body._id).toBe(id);

    const updated = await request(app)
      .put(`/api/notes/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: enc('changed') });
    expect(updated.status).toBe(200);

    const removed = await request(app).delete(`/api/notes/${id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(removed.status).toBe(200);

    const afterDelete = await request(app).get(`/api/notes/${id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(afterDelete.status).toBe(404);
  });

  it("denies a different user reading, updating, or deleting another user's note", async () => {
    const created = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(notePayload('secret'));
    const id = created.body._id;

    // Bob must not be able to read Alice's note (content + password-hash leak).
    expect((await request(app).get(`/api/notes/${id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);

    // Bob must not be able to update it...
    const bobUpdate = await request(app)
      .put(`/api/notes/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ content: enc('hacked') });
    expect(bobUpdate.status).toBe(404);

    // ...and the note must be untouched on disk.
    const onDisk = await Note.findById(id);
    expect(onDisk).toBeTruthy();

    // Bob must not be able to delete it; it still exists afterward.
    expect((await request(app).delete(`/api/notes/${id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    expect(await Note.findById(id)).toBeTruthy();
  });

  it('owner can create → update → delete a task (round-trip)', async () => {
    const created = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(taskPayload('do-it'));
    expect(created.status).toBe(201);
    const id = created.body._id;

    const updated = await request(app)
      .put(`/api/tasks/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ completed: enc('true') });
    expect(updated.status).toBe(200);

    const removed = await request(app).delete(`/api/tasks/${id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(removed.status).toBe(200);
    expect(await Task.findById(id)).toBeNull();
  });

  it('deleting a task_list cascade-removes its child tasks (type is encrypted at rest)', async () => {
    // The list note's type is E2E-encrypted, so the backend can't read `task_list`
    // off it — the cascade must key on the plaintext parentNoteId instead.
    const list = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...notePayload('my list'), type: enc('task_list') });
    expect(list.status).toBe(201);
    const listId = list.body._id;

    const child = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...taskPayload('child'), parentNoteId: listId });
    expect(child.status).toBe(201);
    const childId = child.body._id;
    expect(await Task.findById(childId)).toBeTruthy();

    const removed = await request(app).delete(`/api/notes/${listId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(removed.status).toBe(200);

    // The child task must not be orphaned in the DB.
    expect(await Task.findById(childId)).toBeNull();
    expect(await Task.find({ parentNoteId: listId })).toHaveLength(0);
  });

  it('deleting a plain note leaves unrelated tasks untouched (cascade is a safe no-op)', async () => {
    const note = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(notePayload('plain'));
    const noteId = note.body._id;

    const standalone = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(taskPayload('standalone'));
    const standaloneId = standalone.body._id;

    expect((await request(app).delete(`/api/notes/${noteId}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    expect(await Task.findById(standaloneId)).toBeTruthy();
  });

  it("denies a different user updating or deleting another user's task", async () => {
    const created = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(taskPayload('private'));
    const id = created.body._id;

    const bobUpdate = await request(app)
      .put(`/api/tasks/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ completed: enc('true') });
    expect(bobUpdate.status).toBe(404);
    expect((await request(app).delete(`/api/tasks/${id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);

    // Task survives both attempts.
    expect(await Task.findById(id)).toBeTruthy();
  });
});
