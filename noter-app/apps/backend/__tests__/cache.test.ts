const connectMock = jest.fn(async () => undefined);
const getMock = jest.fn(async () => null);
const setMock = jest.fn(async () => 'OK');
const delMock = jest.fn(async () => 1);
const pingMock = jest.fn(async () => 'PONG');
const quitMock = jest.fn(async () => 'OK');
const onMock = jest.fn();
const createClientMock = jest.fn(() => ({
  isOpen: false,
  connect: connectMock,
  get: getMock,
  set: setMock,
  del: delMock,
  ping: pingMock,
  quit: quitMock,
  on: onMock,
}));

jest.mock('redis', () => ({
  createClient: (...args: any[]) => createClientMock(...args),
}));

describe('cache service env fallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockClear();
    connectMock.mockClear();
    getMock.mockClear();
    setMock.mockClear();
    delMock.mockClear();
    pingMock.mockClear();
    quitMock.mockClear();
    onMock.mockClear();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('disables redis operations when REDIS_URL is not configured', async () => {
    const cache = (await import('../src/services/cache')).default;
    await expect(cache.get('notes:list:user-1')).resolves.toBeNull();
    await expect(cache.set('notes:list:user-1', { ok: true })).resolves.toBeUndefined();
    await expect(cache.del('notes:list:user-1')).resolves.toBeUndefined();
    await expect(cache.delMany(['notes:list:user-1'])).resolves.toBeUndefined();
    await expect(cache.ping()).resolves.toBe(false);
    await expect(cache.close()).resolves.toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
