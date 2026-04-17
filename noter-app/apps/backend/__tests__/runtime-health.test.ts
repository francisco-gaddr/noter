import { buildHealthResponse, buildReadyResponse } from '../src/services/runtimeHealth';

describe('runtime health helpers', () => {
  it('marks health as degraded when a dependency is down', () => {
    const response = buildHealthResponse({
      mongoOk: true,
      redisOk: false,
      isReady: false,
      isShuttingDown: false,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.mongo).toBe(true);
    expect(response.body.redis).toBe(false);
  });

  it('marks readiness as not-ready during shutdown', () => {
    const response = buildReadyResponse({
      mongoOk: true,
      redisOk: true,
      isReady: true,
      isShuttingDown: true,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body.status).toBe('not-ready');
    expect(response.body.shuttingDown).toBe(true);
  });
});
