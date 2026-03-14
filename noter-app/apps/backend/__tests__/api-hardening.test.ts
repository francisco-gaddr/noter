import request from 'supertest';
import { app, server } from '../src/index';

describe('API hardening integration', () => {
  afterAll(() => {
    server.close();
  });

  it('rejects non-json content-type for write endpoints', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('username=user&password=pass');
    expect(res.status).toBe(415);
  });

  it('blocks suspicious injection-like query payloads', async () => {
    const res = await request(app)
      .get('/api/notes?$where=this.password')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(400);
  });

  it('registers ai sync route under /api/ai/sync', async () => {
    const res = await request(app).get('/api/ai/sync/pull');
    expect([401, 403]).toContain(res.status);
  });
});

