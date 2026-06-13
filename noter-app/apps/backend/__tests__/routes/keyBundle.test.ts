import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import keyBundleRoutes from '../../src/routes/keyBundle';
import { errorHandler } from '../../src/middleware/errorMiddleware';
import User from '../../src/models/User';
import { getJwtSecret, getJwtSignOptions } from '../../src/utils/security';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(express.json());
app.use('/api/keys', authMiddleware, keyBundleRoutes);
app.use(errorHandler);

const b64 = (s: string) => Buffer.from(s).toString('base64');
const validBundle = {
  wrappedDataKey: 'v3w:' + b64('x'.repeat(48)),
  kdfSalt: b64('0123456789abcdef'),
  kdf: 'argon2id',
  keyVersion: 1,
};

describe('key bundle routes (E2E key storage)', () => {
  let mongoServer: MongoMemoryServer;
  let token: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const user = await User.create({ username: 'keyuser', passwordHash: 'x' });
    token = jwt.sign({ userId: user._id }, getJwtSecret(), getJwtSignOptions());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('404s before enrolment', async () => {
    const res = await request(app).get('/api/keys/bundle').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_KEY_BUNDLE');
  });

  it('stores then returns the opaque bundle (round-trip)', async () => {
    const put = await request(app).put('/api/keys/bundle').set('Authorization', `Bearer ${token}`).send(validBundle);
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/keys/bundle').set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.wrappedDataKey).toBe(validBundle.wrappedDataKey);
    expect(get.body.kdf).toBe('argon2id');
    expect(get.body.keyVersion).toBe(1);
  });

  it('rejects a wrappedDataKey without the v3w: envelope prefix', async () => {
    const res = await request(app)
      .put('/api/keys/bundle')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBundle, wrappedDataKey: 'not-an-envelope' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown kdf', async () => {
    const res = await request(app)
      .put('/api/keys/bundle')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBundle, kdf: 'md5' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/keys/bundle');
    expect(res.status).toBe(401);
  });
});
