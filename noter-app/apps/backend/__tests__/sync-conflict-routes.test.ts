import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { encrypt } from '@repo/shared';
import { authMiddleware } from '../src/middleware/authMiddleware';
import noteRoutes from '../src/routes/notes';
import taskRoutes from '../src/routes/tasks';
import Note from '../src/models/Note';
import Task from '../src/models/Task';
import DeletionTombstone from '../src/models/DeletionTombstone';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
jest.setTimeout(30_000);

const app = express();
app.use(bodyParser.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);

describe('sync conflict routes', () => {
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
    await Promise.all([
      Note.deleteMany({}),
      Task.deleteMany({}),
      DeletionTombstone.deleteMany({}),
    ]);
  });

  it('returns 409 when updating a note with stale baseUpdatedAt', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const initialUpdatedAt = new Date('2026-01-01T00:00:01.000Z').toISOString();
    const nextUpdatedAt = new Date('2026-01-01T00:00:02.000Z').toISOString();

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Test note'),
        content: encrypt('content'),
        type: encrypt('note'),
        createdAt: encrypt(createdAt),
        updatedAt: encrypt(initialUpdatedAt),
      });

    expect(createRes.status).toBe(201);

    const updateRes = await request(app)
      .put(`/api/notes/${createRes.body._id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Updated once'),
        content: encrypt('content'),
        updatedAt: encrypt(nextUpdatedAt),
        baseUpdatedAt: initialUpdatedAt,
      });

    expect(updateRes.status).toBe(200);

    const staleRes = await request(app)
      .put(`/api/notes/${createRes.body._id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Stale update'),
        content: encrypt('content'),
        updatedAt: encrypt(new Date('2026-01-01T00:00:03.000Z').toISOString()),
        baseUpdatedAt: initialUpdatedAt,
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.code).toBe('SYNC_CONFLICT');
    expect(staleRes.body.serverUpdatedAt).toBe(nextUpdatedAt);
    expect(staleRes.body.localBaseUpdatedAt).toBe(initialUpdatedAt);
    expect(staleRes.body.itemId).toBe(createRes.body._id);
    expect(staleRes.body.serverItem?._id).toBe(createRes.body._id);
    expect(staleRes.body.conflictFields).toContain('updatedAt');
  });

  it('returns 409 when updating a task with stale baseUpdatedAt', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const initialUpdatedAt = new Date('2026-01-01T00:00:01.000Z').toISOString();
    const nextUpdatedAt = new Date('2026-01-01T00:00:02.000Z').toISOString();

    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Test task'),
        description: encrypt('task'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        createdAt: encrypt(createdAt),
        updatedAt: encrypt(initialUpdatedAt),
      });

    expect(createRes.status).toBe(201);

    const updateRes = await request(app)
      .put(`/api/tasks/${createRes.body._id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Updated once'),
        description: encrypt('task'),
        updatedAt: encrypt(nextUpdatedAt),
        baseUpdatedAt: initialUpdatedAt,
      });

    expect(updateRes.status).toBe(200);

    const staleRes = await request(app)
      .put(`/api/tasks/${createRes.body._id}`)
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Stale update'),
        description: encrypt('task'),
        updatedAt: encrypt(new Date('2026-01-01T00:00:03.000Z').toISOString()),
        baseUpdatedAt: initialUpdatedAt,
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.code).toBe('SYNC_CONFLICT');
    expect(staleRes.body.serverUpdatedAt).toBe(nextUpdatedAt);
    expect(staleRes.body.localBaseUpdatedAt).toBe(initialUpdatedAt);
    expect(staleRes.body.itemId).toBe(createRes.body._id);
    expect(staleRes.body.serverItem?._id).toBe(createRes.body._id);
    expect(staleRes.body.conflictFields).toContain('updatedAt');
  });

  it('returns only notes changed since the requested cursor', async () => {
    const oldUpdatedAt = new Date('2026-01-01T00:00:01.000Z').toISOString();
    const newUpdatedAt = new Date('2026-01-01T00:00:05.000Z').toISOString();

    await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Older note'),
        content: encrypt('old'),
        type: encrypt('note'),
        createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
        updatedAt: encrypt(oldUpdatedAt),
      });

    const recentNote = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Recent note'),
        content: encrypt('recent'),
        type: encrypt('note'),
        createdAt: encrypt(new Date('2026-01-01T00:00:04.000Z').toISOString()),
        updatedAt: encrypt(newUpdatedAt),
      });

    const deltaRes = await request(app)
      .get(`/api/notes/changes?since=${encodeURIComponent(new Date('2026-01-01T00:00:03.000Z').toISOString())}`)
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(Array.isArray(deltaRes.body.items)).toBe(true);
    expect(deltaRes.body.items).toHaveLength(1);
    expect(deltaRes.body.items[0]._id).toBe(recentNote.body._id);
    expect(typeof deltaRes.body.serverTime).toBe('string');
  });

  it('applies an optional limit to note change sets', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post('/api/notes')
        .set('Authorization', 'Bearer demo-token')
        .send({
          title: encrypt(`Note ${index}`),
          content: encrypt('content'),
          type: encrypt('note'),
          createdAt: encrypt(new Date(`2026-01-01T00:00:0${index}.000Z`).toISOString()),
          updatedAt: encrypt(new Date(`2026-01-01T00:00:1${index}.000Z`).toISOString()),
        });
    }

    const deltaRes = await request(app)
      .get('/api/notes/changes?limit=2')
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(deltaRes.body.items).toHaveLength(2);
    expect(deltaRes.body.limit).toBe(2);
    expect(deltaRes.body.hasMore).toBe(true);
  });

  it('returns only tasks changed since the requested cursor', async () => {
    const oldUpdatedAt = new Date('2026-01-01T00:00:01.000Z').toISOString();
    const newUpdatedAt = new Date('2026-01-01T00:00:05.000Z').toISOString();

    await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Older task'),
        description: encrypt('old'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
        updatedAt: encrypt(oldUpdatedAt),
      });

    const recentTask = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Recent task'),
        description: encrypt('recent'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        createdAt: encrypt(new Date('2026-01-01T00:00:04.000Z').toISOString()),
        updatedAt: encrypt(newUpdatedAt),
      });

    const deltaRes = await request(app)
      .get(`/api/tasks/changes?since=${encodeURIComponent(new Date('2026-01-01T00:00:03.000Z').toISOString())}`)
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(Array.isArray(deltaRes.body.items)).toBe(true);
    expect(deltaRes.body.items).toHaveLength(1);
    expect(deltaRes.body.items[0]._id).toBe(recentTask.body._id);
    expect(typeof deltaRes.body.serverTime).toBe('string');
  });

  it('applies an optional limit to task change sets', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post('/api/tasks')
        .set('Authorization', 'Bearer demo-token')
        .send({
          title: encrypt(`Task ${index}`),
          description: encrypt('task'),
          completed: encrypt('false'),
          priority: encrypt('medium'),
          createdAt: encrypt(new Date(`2026-01-01T00:00:0${index}.000Z`).toISOString()),
          updatedAt: encrypt(new Date(`2026-01-01T00:00:1${index}.000Z`).toISOString()),
        });
    }

    const deltaRes = await request(app)
      .get('/api/tasks/changes?limit=2')
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(deltaRes.body.items).toHaveLength(2);
    expect(deltaRes.body.limit).toBe(2);
    expect(deltaRes.body.hasMore).toBe(true);
  });

  it('returns deleted note ids in note change sets', async () => {
    const createdRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Delete me'),
        content: encrypt('bye'),
        type: encrypt('note'),
        createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
        updatedAt: encrypt(new Date('2026-01-01T00:00:01.000Z').toISOString()),
      });

    expect(createdRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/notes/${createdRes.body._id}`)
      .set('Authorization', 'Bearer demo-token');

    expect(deleteRes.status).toBe(200);

    const deltaRes = await request(app)
      .get('/api/notes/changes')
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(deltaRes.body.deletedIds).toContain(createdRes.body._id);
  });

  it('returns deleted task ids in task change sets', async () => {
    const createdRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Delete task'),
        description: encrypt('bye'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
        updatedAt: encrypt(new Date('2026-01-01T00:00:01.000Z').toISOString()),
      });

    expect(createdRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/tasks/${createdRes.body._id}`)
      .set('Authorization', 'Bearer demo-token');

    expect(deleteRes.status).toBe(200);

    const deltaRes = await request(app)
      .get('/api/tasks/changes')
      .set('Authorization', 'Bearer demo-token');

    expect(deltaRes.status).toBe(200);
    expect(deltaRes.body.deletedIds).toContain(createdRes.body._id);
  });

  it('applies bulk note sync create operations', async () => {
    const res = await request(app)
      .post('/api/notes/sync')
      .set('Authorization', 'Bearer demo-token')
      .send({
        operations: [
          {
            clientOperationId: 'op-note-create',
            action: 'CREATE',
            tempId: 'temp-note',
            data: {
              title: encrypt('Bulk note'),
              content: encrypt('content'),
              type: encrypt('note'),
              createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
              updatedAt: encrypt(new Date('2026-01-01T00:00:01.000Z').toISOString()),
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      clientOperationId: 'op-note-create',
      action: 'CREATE',
      entity: 'NOTE',
      status: 'applied',
      tempId: 'temp-note',
    });
    expect(typeof res.body.results[0].itemId).toBe('string');
  });

  it('applies bulk task sync create operations', async () => {
    const res = await request(app)
      .post('/api/tasks/sync')
      .set('Authorization', 'Bearer demo-token')
      .send({
        operations: [
          {
            clientOperationId: 'op-task-create',
            action: 'CREATE',
            tempId: 'temp-task',
            data: {
              title: encrypt('Bulk task'),
              description: encrypt('content'),
              completed: encrypt('false'),
              priority: encrypt('medium'),
              createdAt: encrypt(new Date('2026-01-01T00:00:00.000Z').toISOString()),
              updatedAt: encrypt(new Date('2026-01-01T00:00:01.000Z').toISOString()),
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      clientOperationId: 'op-task-create',
      action: 'CREATE',
      entity: 'TASK',
      status: 'applied',
      tempId: 'temp-task',
    });
    expect(typeof res.body.results[0].itemId).toBe('string');
  });
});
