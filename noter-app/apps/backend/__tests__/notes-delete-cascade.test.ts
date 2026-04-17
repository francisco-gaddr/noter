import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { encrypt } from '@repo/shared';
import { authMiddleware } from '../src/middleware/authMiddleware';
import noteRoutes from '../src/routes/notes';
import taskRoutes from '../src/routes/tasks';
import Note from '../src/models/Note';
import Task from '../src/models/Task';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
jest.setTimeout(30_000);

const app = express();
app.use(express.json());
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);

const encDate = () => encrypt(new Date().toISOString());

describe('notes delete cascade', () => {
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
    await Promise.all([Note.deleteMany({}), Task.deleteMany({})]);
  });

  it('removes descendant notes and tasks when deleting a project', async () => {
    const projectRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Projekt'),
        content: encrypt(''),
        type: encrypt('project'),
        createdAt: encDate(),
        updatedAt: encDate(),
      });
    expect(projectRes.status).toBe(201);

    const taskListRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Lista'),
        content: encrypt(''),
        type: encrypt('task_list'),
        parentId: projectRes.body._id,
        createdAt: encDate(),
        updatedAt: encDate(),
      });
    expect(taskListRes.status).toBe(201);

    const noteRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Anteckning'),
        content: encrypt('text'),
        type: encrypt('note'),
        parentId: projectRes.body._id,
        createdAt: encDate(),
        updatedAt: encDate(),
      });
    expect(noteRes.status).toBe(201);

    const childNoteRes = await request(app)
      .post('/api/notes')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Underanteckning'),
        content: encrypt('text'),
        type: encrypt('note'),
        parentId: noteRes.body._id,
        createdAt: encDate(),
        updatedAt: encDate(),
      });
    expect(childNoteRes.status).toBe(201);

    const taskRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer demo-token')
      .send({
        title: encrypt('Uppgift'),
        description: encrypt(''),
        parentNoteId: taskListRes.body._id,
        completed: encrypt('false'),
        priority: encrypt('medium'),
        createdAt: encDate(),
        updatedAt: encDate(),
      });
    expect(taskRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/notes/${projectRes.body._id}`)
      .set('Authorization', 'Bearer demo-token');

    expect(deleteRes.status).toBe(200);
    expect(await Note.countDocuments({})).toBe(0);
    expect(await Task.countDocuments({})).toBe(0);
  });
});
