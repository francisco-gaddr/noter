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
  app.use('/api/notes', (req, _res, next) => {
    req.headers.authorization = 'Bearer demo-token';
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
