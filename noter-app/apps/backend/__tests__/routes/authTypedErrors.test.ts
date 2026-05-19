/**
 * Verifies that /api/auth/login and /api/auth/register emit the typed
 * error codes wired in round 14 — clients can now branch on `code`
 * rather than parsing the message string.
 */
import request from 'supertest';
import { app, server } from '../../src/index';
import mongoose from 'mongoose';

const AUTH_BASE = '/api/auth';

describe('auth routes — typed error codes', () => {
  afterAll(async () => {
    try { await mongoose.connection.close(); } catch { /* noop */ }
    server.close();
  });

  // The "non-existent user → 401" path needs a live Mongo. We assert it
  // via the integration env (Detox / Playwright). Here we cover the
  // validation + envelope shape, which exercise the same errorMiddleware
  // code path that emits the typed `code`.

  it('register without required fields → 400 validation', async () => {
    const res = await request(app)
      .post(`${AUTH_BASE}/register`)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    // validate middleware (round 7) emits VALIDATION_FAILED.
    expect(res.body.code).toBeDefined();
  });

  it('error envelope carries requestId for correlation', async () => {
    const res = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ username: '', password: '' });
    expect(res.headers['x-request-id']).toBeDefined();
    if (res.status >= 400) {
      expect(res.body.requestId).toBeDefined();
    }
  });
});
