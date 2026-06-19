import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import accountRoutes from '../../src/routes/account';
import { userDataKeys } from '../../src/services/userData';
import User from '../../src/models/User';
import Note from '../../src/models/Note';
import Task from '../../src/models/Task';

let mongo: MongoMemoryServer;
let app: express.Express;

// Auth stub: req.user.userId is taken from an x-user header (mirrors the real authMiddleware).
const asUser = (id: string) => ({ 'x-user': id });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/account', (req, _res, next) => {
    const id = req.headers['x-user'];
    if (id) (req as any).user = { userId: String(id) };
    next();
  }, accountRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Note.deleteMany({}), Task.deleteMany({})]);
});

const seedUser = async (username: string) => {
  const u = await User.create({ username, passwordHash: 'secret-hash', keyBundle: { wrappedDataKey: 'v3w:abc', kdfSalt: 's', kdf: 'argon2id', keyVersion: 1 } as any });
  return String(u._id);
};

describe('GET /api/account/export (GDPR access/portability)', () => {
  it('exports the user + all data collections, with keyBundle but NO secrets', async () => {
    const userId = await seedUser('alice');
    await Note.create({ userId, title: 'enc-title', content: 'enc-body', type: 'note' });
    await Task.create({ userId, title: 'enc-task' });

    const res = await request(app).get('/api/account/export').set(asUser(userId));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    // Every declared collection key is present in the export (completeness).
    for (const key of userDataKeys()) expect(res.body).toHaveProperty(key);
    expect(res.body.user.username).toBe('alice');
    expect(res.body.user.keyBundle).toBeTruthy(); // needed for the client to decrypt locally
    expect(JSON.stringify(res.body.user)).not.toContain('secret-hash'); // passwordHash never exported
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.notes[0].content).toBe('enc-body'); // ciphertext returned as-is
  });

  it('only ever exports the authenticated user’s own data', async () => {
    const a = await seedUser('alice');
    const b = await seedUser('bob');
    await Note.create({ userId: a, title: 'a-note', content: 'x', type: 'note' });
    await Note.create({ userId: b, title: 'b-note', content: 'y', type: 'note' });
    const res = await request(app).get('/api/account/export').set(asUser(b));
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].title).toBe('b-note'); // never alice's
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/account/export')).status).toBe(401);
  });
});

describe('DELETE /api/account (GDPR erasure)', () => {
  it('requires confirmUsername matching the account username', async () => {
    const userId = await seedUser('alice');
    expect((await request(app).delete('/api/account').set(asUser(userId)).send({})).status).toBe(400); // missing
    expect((await request(app).delete('/api/account').set(asUser(userId)).send({ confirmUsername: 'wrong' })).status).toBe(400); // mismatch
    expect(await User.findById(userId)).not.toBeNull(); // still here
  });

  it('hard-deletes the user + all their data on confirmation', async () => {
    const userId = await seedUser('alice');
    await Note.create({ userId, title: 't', content: 'c', type: 'note' });
    await Task.create({ userId, title: 'task' });

    const res = await request(app).delete('/api/account').set(asUser(userId)).send({ confirmUsername: 'alice' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deleted.notes).toBe(1);
    expect(res.body.deleted.user).toBe(1);
    expect(await User.findById(userId)).toBeNull();
    expect(await Note.countDocuments({ userId })).toBe(0);
    expect(await Task.countDocuments({ userId })).toBe(0);
  });

  it('does not touch another user’s data', async () => {
    const a = await seedUser('alice');
    const b = await seedUser('bob');
    await Note.create({ userId: b, title: 'b', content: 'y', type: 'note' });
    await request(app).delete('/api/account').set(asUser(a)).send({ confirmUsername: 'alice' });
    expect(await User.findById(b)).not.toBeNull(); // bob intact
    expect(await Note.countDocuments({ userId: b })).toBe(1);
  });

  it('requires authentication', async () => {
    expect((await request(app).delete('/api/account').send({ confirmUsername: 'x' })).status).toBe(401);
  });
});
