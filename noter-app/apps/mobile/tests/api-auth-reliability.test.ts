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

describe('API auth reliability', () => {
  let secureStore: any;

  beforeEach(() => {
    jest.resetModules();
    secureStore = require('expo-secure-store');
    secureStore.getItemAsync.mockReset();
    secureStore.setItemAsync.mockReset();
    secureStore.deleteItemAsync.mockReset();
    global.fetch = jest.fn() as any;
    Object.defineProperty(global, '__DEV__', { value: true, writable: true, configurable: true });
  });

  it('calls unauthorized handler and clears token on 401', async () => {
    const api = require('../services/api');
    const onUnauthorized = jest.fn();
    api.setUnauthorizedHandler(onUnauthorized);
    api.setAuthToken('token-1');
    secureStore.getItemAsync.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Unauthorized' }),
      text: async () => 'Unauthorized',
    });

    await expect(api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' })).rejects.toThrow('Unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('token');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
  });

  it('skips session teardown when unauthorized handling is explicitly bypassed', async () => {
    const api = require('../services/api');
    const onUnauthorized = jest.fn();
    api.setUnauthorizedHandler(onUnauthorized);
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Unauthorized' }),
      text: async () => 'Unauthorized',
    });

    await expect(
      api.fetchWithAuth('/graphql', { method: 'POST', body: '{}', skipUnauthorized: true })
    ).rejects.toThrow('Unauthorized');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('retries transient server errors and succeeds', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'busy' }),
        text: async () => 'busy',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ok: true } }),
      });

    const res = await api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' });
    expect(res).toEqual({ data: { ok: true } });
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('backs off and recovers after rate limiting', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Too many requests' }),
        text: async () => 'Too many requests',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { throttled: false } }),
      });

    const res = await api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' });
    expect(res).toEqual({ data: { throttled: false } });
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('retries network failure and returns improved error text', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await expect(api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' })).rejects.toThrow('Could not connect to server');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  });

  it('retries abort-like failures and returns a timeout error', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock).mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    await expect(api.fetchWithAuth('/notes')).rejects.toThrow('Request timed out');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  });

  it('recovers after a transient abort during note loading', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([]),
      });

    const res = await api.fetchWithAuth('/notes');
    expect(res).toEqual([]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('refreshes once on 401 and retries the original request', async () => {
    const api = require('../services/api');
    const onUnauthorized = jest.fn();
    const onTokenUpdate = jest.fn();
    api.setUnauthorizedHandler(onUnauthorized);
    api.setTokenUpdateHandler(onTokenUpdate);
    api.setAuthToken('expired-token');
    secureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === 'refresh_token') return 'refresh-123';
      return null;
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Unauthorized' }),
        text: async () => 'Unauthorized',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'fresh-token', refreshToken: 'refresh-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ok: true } }),
      });

    const res = await api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' });
    expect(res).toEqual({ data: { ok: true } });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onTokenUpdate).toHaveBeenCalledWith('fresh-token');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh-456');
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('/auth/refresh');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  });
});
