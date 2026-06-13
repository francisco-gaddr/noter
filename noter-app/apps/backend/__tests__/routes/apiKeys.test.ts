import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import apiKeysRoutes from '../../src/routes/apiKeys';
import { apiKeyAuth } from '../../src/middleware/apiKeyAuth';
import { errorHandler } from '../../src/middleware/errorMiddleware';
import User from '../../src/models/User';
import { getJwtSecret, getJwtSignOptions } from '../../src/utils/security';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.use(express.json());
app.use('/api/keys', authMiddleware, apiKeysRoutes);
// A protected endpoint that accepts ONLY a minted API key, to prove the minted
// token actually authenticates (mint ↔ verify round-trip).
app.get('/api/protected', apiKeyAuth([]), (_req, res) => res.json({ ok: true }));
app.use(errorHandler);

describe('api-keys routes (external integration)', () => {
  let mongoServer: MongoMemoryServer;
  let token: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const user = await User.create({ username: 'apikeyuser', passwordHash: 'x' });
    token = jwt.sign({ userId: user._id }, getJwtSecret(), getJwtSignOptions());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('mints a key whose token authenticates, lists it without the secret, then revokes it', async () => {
    const mint = await request(app)
      .post('/api/keys/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ scopes: ['notes:read'] });
    expect(mint.status).toBe(201);
    expect(mint.body.token).toMatch(/^nk_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$/);
    const { token: apiKey, kid } = mint.body;

    // The minted key authenticates the protected endpoint.
    const protectedOk = await request(app).get('/api/protected').set('Authorization', `ApiKey ${apiKey}`);
    expect(protectedOk.status).toBe(200);

    // Listing returns the key metadata but never the secret/hash.
    const list = await request(app).get('/api/keys/api-keys').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const entry = list.body.keys.find((k: any) => k.kid === kid);
    expect(entry).toBeTruthy();
    expect(entry.hash).toBeUndefined();
    expect(entry.scopes).toEqual(['notes:read']);

    // Revoke, then the key no longer authenticates.
    const del = await request(app).delete(`/api/keys/api-keys/${kid}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    const afterRevoke = await request(app).get('/api/protected').set('Authorization', `ApiKey ${apiKey}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('rejects an unknown scope', async () => {
    const res = await request(app)
      .post('/api/keys/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ scopes: ['notes:delete-everything'] });
    expect(res.status).toBe(400);
  });

  it('404s revoking a non-existent kid', async () => {
    const res = await request(app).delete('/api/keys/api-keys/zzzzzzzz').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/keys/api-keys')).status).toBe(401);
    expect((await request(app).post('/api/keys/api-keys').send({})).status).toBe(401);
  });
});
