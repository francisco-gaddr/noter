jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (v: any) => v.ios || v.default },
}));

jest.mock('expo-constants', () => ({
  expoConfig: {},
  appOwnership: 'guest',
}));

describe('API URL security', () => {
  const previousDev = (global as any).__DEV__;

  const setNodeEnv = (value?: string) => {
    if (value === undefined) {
      Object.defineProperty(process.env, 'NODE_ENV', { value: undefined, writable: true, configurable: true });
      return;
    }
    Object.defineProperty(process.env, 'NODE_ENV', { value, writable: true, configurable: true });
  };

  afterEach(() => {
    jest.resetModules();
    setNodeEnv(undefined);
    (global as any).__DEV__ = previousDev;
  });

  it('normalizes api url with /api suffix', async () => {
    setNodeEnv('development');
    const api = require('../services/api');
    await api.setApiUrl('https://example.com');
    expect(api.API_URL).toBe('https://example.com/api');
  });

  it('rejects insecure non-local http url in production mode', async () => {
    (global as any).__DEV__ = false;
    setNodeEnv('production');
    const api = require('../services/api');
    await expect(api.setApiUrl('http://example.com')).rejects.toThrow('HTTPS');
  });

  it('allows localhost http for simulator-safe development flows', async () => {
    (global as any).__DEV__ = false;
    setNodeEnv('production');
    const api = require('../services/api');
    await api.setApiUrl('http://127.0.0.1:3001');
    expect(api.API_URL).toBe('http://127.0.0.1:3001/api');
  });

  it('preserves nested api paths without duplicating suffixes', async () => {
    setNodeEnv('development');
    const api = require('../services/api');
    await api.setApiUrl('https://example.com/custom/api/');
    expect(api.API_URL).toBe('https://example.com/custom/api');
  });
});
