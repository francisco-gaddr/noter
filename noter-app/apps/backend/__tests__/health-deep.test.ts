import request from 'supertest';
import express from 'express';
import healthDeepRoutes from '../src/routes/healthDeep';

// Loopback requests are allowed without HEALTH_DEEP_TOKEN, so supertest (which
// connects over 127.0.0.1) can reach the endpoint without extra setup.
const app = express();
app.use('/api/health/deep', healthDeepRoutes);

describe('GET /api/health/deep', () => {
  it('reports version + securityLevel so dashboards can show the live posture', async () => {
    const res = await request(app).get('/api/health/deep');
    // 503 is expected here because Mongo isn't connected in this isolated test —
    // the contract we care about is the SHAPE, which is identical for ok/degraded.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof res.body.securityLevel).toBe('string');
    expect(res.body.securityLevel.length).toBeGreaterThan(0);
    expect(typeof res.body.uptime_sec).toBe('number');
    expect(res.body.checks).toHaveProperty('mongo');
    expect(res.body.checks).toHaveProperty('redis');
    // Change-stream observability: a boolean degraded flag (false in a fresh process).
    expect(res.body.changeStream).toEqual({ degraded: false });
  });
});
