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

  it('retries network failure and returns improved error text', async () => {
    const api = require('../services/api');
    api.setAuthToken('token-1');
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await expect(api.fetchWithAuth('/graphql', { method: 'POST', body: '{}' })).rejects.toThrow('Could not connect to server');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  });
});
