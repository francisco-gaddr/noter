export type RuntimeHealthState = {
  mongoOk: boolean;
  redisOk: boolean;
  isReady: boolean;
  isShuttingDown: boolean;
};

export const buildHealthResponse = ({ mongoOk, redisOk }: RuntimeHealthState) => {
  const ok = mongoOk && redisOk;
  return {
    statusCode: ok ? 200 : 503,
    body: {
      status: ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      mongo: mongoOk,
      redis: redisOk,
    },
  };
};

export const buildReadyResponse = ({ mongoOk, redisOk, isReady, isShuttingDown }: RuntimeHealthState) => {
  const ready = isReady && !isShuttingDown && mongoOk && redisOk;
  return {
    statusCode: ready ? 200 : 503,
    body: {
      status: ready ? 'ready' : 'not-ready',
      time: new Date().toISOString(),
      mongo: mongoOk,
      redis: redisOk,
      shuttingDown: isShuttingDown,
    },
  };
};
