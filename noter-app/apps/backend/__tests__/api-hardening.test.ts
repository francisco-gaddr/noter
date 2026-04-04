import request from 'supertest';
import { app, server } from '../src/index';

jest.setTimeout(30000);

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

  it('blocks encoded sql-like probes before route handling', async () => {
    const res = await request(app)
      .get('/api/notes?search=%24where%3Dthis.password')
      .set('Authorization', 'Bearer demo-token');
    expect(res.status).toBe(400);
  });

  it('rate limits repeated auth failures from the same ip', async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 21; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'ab', password: 'short' });
      statuses.push(res.status);
    }

    expect(statuses).toContain(400);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('registers ai sync route under /api/ai/sync', async () => {
    const res = await request(app).get('/api/ai/sync/pull');
    expect([401, 403]).toContain(res.status);
  });
});

