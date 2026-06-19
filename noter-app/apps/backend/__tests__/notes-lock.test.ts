import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import noteRoutes from '../src/routes/notes';
import { encrypt } from '@repo/shared';
import Note from '../src/models/Note';

let mongo: MongoMemoryServer;
let app: express.Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.set('io', { to: () => ({ emit: () => null }) });
  // Stub auth: the real authMiddleware populates req.user from the JWT. The
  // routes read req.user.userId (and now scope every /:id lookup by it), so the
  // stub must set req.user — not just the header — or the handlers throw.
  app.use('/api/notes', (req, _res, next) => {
    (req as any).user = { userId: 'demo-user-id' };
    next();
  }, noteRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Note.deleteMany({});
});

it('verifies lock with raw password hash', async () => {
  const password = 'secret';
  const hashed = await bcrypt.hash(password, 10);
  const note = await Note.create({
    userId: 'demo-user-id',
    title: encrypt('Title'),
    content: encrypt('Content'),
    locked: encrypt('true'),
    password: hashed,
  });

  const res = await request(app)
    .post(`/api/notes/${note._id}/verify-lock`)
    .send({ password });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

it('verifies lock when client sends encrypted password', async () => {
  const password = 'secret';
  const hashed = await bcrypt.hash(password, 10);
  const note = await Note.create({
    userId: 'demo-user-id',
    title: encrypt('Title'),
    content: encrypt('Content'),
    locked: encrypt('true'),
    password: hashed,
  });

  const res = await request(app)
    .post(`/api/notes/${note._id}/verify-lock`)
    .send({ password: encrypt(password) });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

it('SECURITY: locks the note after 5 consecutive wrong passwords (OWASP A07 account lockout)', async () => {
  const hashed = await bcrypt.hash('correct-pw', 10);
  const note = await Note.create({
    userId: 'demo-user-id',
    title: encrypt('Title'), content: encrypt('Content'), locked: encrypt('true'), password: hashed,
  });
  const attempt = (pw: string) => request(app).post(`/api/notes/${note._id}/verify-lock`).send({ password: pw });

  // The first 5 wrong guesses are rejected softly (200 success:false — keeps the frontend logged in).
  for (let i = 0; i < 5; i += 1) {
    const r = await attempt('wrong');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
  }
  // The 6th wrong guess crosses the threshold → hard 429 with a Retry-After cool-down.
  const blocked = await attempt('wrong');
  expect(blocked.status).toBe(429);
  expect(blocked.body.success).toBe(false);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  // Even the CORRECT password is refused while the lockout is active.
  const stillBlocked = await attempt('correct-pw');
  expect(stillBlocked.status).toBe(429);
});

it('SECURITY: a correct password resets the failure counter (legitimate typos are not penalised)', async () => {
  const hashed = await bcrypt.hash('correct-pw', 10);
  const note = await Note.create({
    userId: 'demo-user-id',
    title: encrypt('Title'), content: encrypt('Content'), locked: encrypt('true'), password: hashed,
  });
  const attempt = (pw: string) => request(app).post(`/api/notes/${note._id}/verify-lock`).send({ password: pw });

  for (let i = 0; i < 4; i += 1) expect((await attempt('wrong')).body.success).toBe(false); // 4 typos
  expect((await attempt('correct-pw')).body.success).toBe(true);                              // success → reset
  // The counter is cleared: a fresh wrong guess is soft-rejected (200), NOT locked out (429).
  const after = await attempt('wrong');
  expect(after.status).toBe(200);
  expect(after.body.success).toBe(false);
});

it('SECURITY: a newly set lock password is hashed at bcrypt cost >= 12 (OWASP 2025)', async () => {
  const res = await request(app).post('/api/notes').send({
    title: encrypt('t'), content: encrypt('c'), type: encrypt('note'),
    locked: encrypt('true'), password: encrypt('my-lock-pw'),
    createdAt: encrypt(new Date().toISOString()), updatedAt: encrypt(new Date().toISOString()),
  });
  expect(res.status).toBe(201);
  const stored = await Note.findById(res.body._id).select('+password');
  // bcrypt encodes the cost in the hash: $2<x>$<cost>$...
  expect(stored?.password).toMatch(/^\$2[aby]\$12\$/);
});
