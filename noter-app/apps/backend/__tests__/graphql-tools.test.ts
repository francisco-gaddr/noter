import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createHandler } from 'graphql-http/lib/use/express';
import { encrypt, setEncryptionKey } from '@repo/shared';
import { toolSchema } from '../src/graphql/schema';
import { graphqlOperationLimitRule } from '../src/graphql/validation';
import { authMiddleware, getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from '../src/middleware/authMiddleware';
import User from '../src/models/User';
import Note from '../src/models/Note';
import Task from '../src/models/Task';

jest.setTimeout(120000);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

jest.mock('../src/services/cache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

const app = express();
app.use(bodyParser.json());
app.use('/api/graphql', authMiddleware, createHandler({
  schema: toolSchema,
  validationRules: [graphqlOperationLimitRule],
  context: (req: any) => {
    let userId = req?.user?.userId || req?.raw?.user?.userId;
    const token = getBearerTokenFromRequestLike(req);
    if (!userId && token === 'demo-token') userId = 'demo-user-id';
    if (!userId && token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
        userId = getUserIdFromDecodedToken(decoded);
      } catch {}
    }
    return { userId };
  }
}));

describe('GraphQL Tool Calls', () => {
  let mongoServer: MongoMemoryServer;
  const signToken = (payload: Record<string, string | number>) =>
    jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '1h' });
  const createUserWithClaim = async (claimKey: 'userId' | 'id' | '_id', value: string) => {
    await User.create({
      _id: new mongoose.Types.ObjectId(value),
      username: `${claimKey}-${value.slice(0, 6)}`,
      passwordHash: 'hash',
      tokenVersion: 1,
    });
    return signToken({ [claimKey]: value, tokenVersion: 1 });
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    setEncryptionKey('a'.repeat(64));
    await User.deleteMany({});
    await Note.deleteMany({});
    await Task.deleteMany({});
  });

  it('creates, reads, updates and deletes notes', async () => {
    const encryptedTitle = encrypt('Test');
    const encryptedContent = encrypt('Body');
    const encryptedTagA = encrypt('a');
    const encryptedTagB = encrypt('b');
    const updatedTitle = encrypt('Updated');
    const createRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title content tags}}',
        variables: { input: { title: encryptedTitle, content: encryptedContent, tags: [encryptedTagA, encryptedTagB] } }
      });

    expect(createRes.status).toBe(200);
    if (createRes.body.errors?.length) {
      throw new Error(JSON.stringify(createRes.body.errors));
    }
    const noteId = createRes.body.data.createNote._id;
    expect(createRes.body.data.createNote.title).toBe(encryptedTitle);

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
        variables: { id: noteId, input: { title: updatedTitle } }
      });

    if (updateRes.body.errors?.length) {
      throw new Error(JSON.stringify(updateRes.body.errors));
    }
    expect(updateRes.body.data.updateNote.title).toBe(updatedTitle);

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
    const projectTitle = encrypt('Project A');
    const projectType = encrypt('project');
    const taskListTitle = encrypt('Tasks A');
    const taskListType = encrypt('task_list');
    const projectRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: projectTitle, type: projectType } }
      });
    if (projectRes.body.errors?.length) {
      throw new Error(JSON.stringify(projectRes.body.errors));
    }

    const taskListRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: taskListTitle, type: taskListType } }
      });
    if (taskListRes.body.errors?.length) {
      throw new Error(JSON.stringify(taskListRes.body.errors));
    }

    const listProjects = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'query($type:String){notes(type:$type){_id title type}}',
        variables: { type: projectType }
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
        variables: { type: taskListType }
      });

    if (listTaskLists.body.errors?.length) {
      throw new Error(JSON.stringify(listTaskLists.body.errors));
    }
    expect(listTaskLists.body.data.notes.length).toBe(1);
  });

  it('creates, reads, updates and deletes tasks', async () => {
    const encryptedTaskTitle = encrypt('Task');
    const encryptedCompletedFalse = encrypt('false');
    const encryptedCompletedTrue = encrypt('true');
    const encryptedPriorityHigh = encrypt('high');
    const createRes = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer demo-token')
      .send({
        query: 'mutation($input:TaskInput!){createTask(input:$input){_id title completed priority}}',
        variables: { input: { title: encryptedTaskTitle, completed: encryptedCompletedFalse, priority: encryptedPriorityHigh } }
      });

    expect(createRes.status).toBe(200);
    if (createRes.body.errors?.length) {
      throw new Error(JSON.stringify(createRes.body.errors));
    }
    const taskId = createRes.body.data.createTask._id;
    expect(createRes.body.data.createTask.title).toBe(encryptedTaskTitle);

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
        variables: { id: taskId, input: { completed: encryptedCompletedTrue } }
      });

    if (updateRes.body.errors?.length) {
      throw new Error(JSON.stringify(updateRes.body.errors));
    }
    expect(updateRes.body.data.updateTask.completed).toBe(encryptedCompletedTrue);

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
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('userId', userId);
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates GraphQL tasks query with token claim id', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('id', userId);
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates GraphQL tasks query with token claim _id', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('_id', userId);
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
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('userId', userId);
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `bearer ${token}`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('authenticates when token is wrapped in quotes/backticks', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('userId', userId);
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer "\`${token}\`"`)
      .send({ query: '{tasks{_id title}}' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
  });

  it('rejects overly expensive GraphQL documents with too many aliased fields', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('userId', userId);
    const query = `{ ${Array.from({ length: 81 }, (_, index) => `t${index}: tasks { _id }`).join(' ')} }`;

    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(String(res.body.errors[0]?.message || '')).toMatch(/field count/i);
  });

  it('rejects weighted-complexity spikes even when field count stays modest', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const token = await createUserWithClaim('userId', userId);
    const query = `{ ${Array.from({ length: 6 }, (_, index) => `t${index}: tasks { _id title }`).join(' ')} }`;

    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(String(res.body.errors[0]?.message || '')).toMatch(/complexity/i);
  });
});
