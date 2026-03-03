import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createHandler } from 'graphql-http/lib/use/express';
import { toolSchema } from '../src/graphql/schema';
import { authMiddleware, getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from '../src/middleware/authMiddleware';
import Note from '../src/models/Note';
import Task from '../src/models/Task';

jest.mock('../src/services/cache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

const app = express();
app.use(bodyParser.json());
app.use('/api/graphql', authMiddleware, createHandler({
  schema: toolSchema,
  context: (req: any) => {
    let userId = req?.user?.userId || req?.raw?.user?.userId;
    const token = getBearerTokenFromRequestLike(req);
    if (!userId && token === 'demo-token') userId = 'demo-user-id';
    if (!userId && token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey');
        userId = getUserIdFromDecodedToken(decoded);
      } catch {}
    }
    return { userId };
  }
}));

describe('GraphQL Tool Calls', () => {
  let mongoServer: MongoMemoryServer;
  const signToken = (payload: Record<string, string>) =>
    jwt.sign(payload, process.env.JWT_SECRET || 'supersecretkey', { expiresIn: '1h' });

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

  it('creates, reads, updates and deletes notes', async () => {
    const createRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title content tags}}',
        variables: { input: { title: 'Test', content: 'Body', tags: ['a', 'b'] } }
      });

    expect(createRes.status).toBe(200);
    if (createRes.body.errors?.length) {
      throw new Error(JSON.stringify(createRes.body.errors));
    }
    const noteId = createRes.body.data.createNote._id;
    expect(createRes.body.data.createNote.title).toBe('Test');

    const listRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({ query: '{notes{_id title content tags}}' });

    if (listRes.body.errors?.length) {
      throw new Error(JSON.stringify(listRes.body.errors));
    }
    expect(listRes.body.data.notes.length).toBe(1);

    const updateRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title}}',
        variables: { id: noteId, input: { title: 'Updated' } }
      });

    if (updateRes.body.errors?.length) {
      throw new Error(JSON.stringify(updateRes.body.errors));
    }
    expect(updateRes.body.data.updateNote.title).toBe('Updated');

    const deleteRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($id:String!){deleteNote(id:$id)}',
        variables: { id: noteId }
      });

    if (deleteRes.body.errors?.length) {
      throw new Error(JSON.stringify(deleteRes.body.errors));
    }
    expect(deleteRes.body.data.deleteNote).toBe(true);
  });

  it('supports project folders and task lists via note type', async () => {
    const projectRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: 'Project A', type: 'project' } }
      });
    if (projectRes.body.errors?.length) {
      throw new Error(JSON.stringify(projectRes.body.errors));
    }

    const taskListRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: 'Tasks A', type: 'task_list' } }
      });
    if (taskListRes.body.errors?.length) {
      throw new Error(JSON.stringify(taskListRes.body.errors));
    }

    const listProjects = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'query($type:String){notes(type:$type){_id title type}}',
        variables: { type: 'project' }
      });

    if (listProjects.body.errors?.length) {
      throw new Error(JSON.stringify(listProjects.body.errors));
    }
    expect(listProjects.body.data.notes.length).toBe(1);

    const listTaskLists = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'query($type:String){notes(type:$type){_id title type}}',
        variables: { type: 'task_list' }
      });

    if (listTaskLists.body.errors?.length) {
      throw new Error(JSON.stringify(listTaskLists.body.errors));
    }
    expect(listTaskLists.body.data.notes.length).toBe(1);
  });

  it('creates, reads, updates and deletes tasks', async () => {
    const createRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:TaskInput!){createTask(input:$input){_id title completed priority}}',
        variables: { input: { title: 'Task', completed: false, priority: 'high' } }
      });

    expect(createRes.status).toBe(200);
    if (createRes.body.errors?.length) {
      throw new Error(JSON.stringify(createRes.body.errors));
    }
    const taskId = createRes.body.data.createTask._id;
    expect(createRes.body.data.createTask.title).toBe('Task');

    const listRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({ query: '{tasks{_id title completed priority}}' });

    if (listRes.body.errors?.length) {
      throw new Error(JSON.stringify(listRes.body.errors));
    }
    expect(listRes.body.data.tasks.length).toBe(1);

    const updateRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id completed}}',
        variables: { id: taskId, input: { completed: true } }
      });

    if (updateRes.body.errors?.length) {
      throw new Error(JSON.stringify(updateRes.body.errors));
    }
    expect(updateRes.body.data.updateTask.completed).toBe(true);

    const deleteRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($id:String!){deleteTask(id:$id)}',
        variables: { id: taskId }
      });

    if (deleteRes.body.errors?.length) {
      throw new Error(JSON.stringify(deleteRes.body.errors));
    }
    expect(deleteRes.body.data.deleteTask).toBe(true);
  });

  it('authenticates GraphQL tasks query with token claim userId', async () => {
    const token = signToken({ userId: 'claim-user-id' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates GraphQL tasks query with token claim id', async () => {
    const token = signToken({ id: 'claim-id' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates GraphQL tasks query with token claim _id', async () => {
    const token = signToken({ _id: 'claim-underscore-id' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('rejects GraphQL token without supported user id claim', async () => {
    const token = signToken({ username: 'no-user-id-claim' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token is not valid');
  });

  it('authenticates with lowercase bearer token prefix', async () => {
    const token = signToken({ userId: 'lower-bearer-user' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates when token is wrapped in quotes/backticks', async () => {
    const token = signToken({ userId: 'quoted-token-user' });
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer "\`${token}\`"`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });
});
