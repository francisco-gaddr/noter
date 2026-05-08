describe('web api session refresh', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    (window as any).mlc = { isElectron: true };
    global.fetch = jest.fn() as any;
  });

  it('refreshes once after a 401 and retries the request', async () => {
    sessionStorage.setItem('token', 'expired-token');
    sessionStorage.setItem('refresh_token', 'refresh-1');
    const { api, setApiAuthTokenListener } = await import('../services/api');
    const tokenListener = jest.fn();
    setApiAuthTokenListener(tokenListener);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'fresh-token', refreshToken: 'refresh-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([]),
      });

    const notes = await api.fetchNotes();
    expect(notes).toEqual([]);
    expect(tokenListener).toHaveBeenCalledWith('fresh-token');
    expect(sessionStorage.getItem('token')).toBe('fresh-token');
    expect(sessionStorage.getItem('refresh_token')).toBe('refresh-2');
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('/auth/refresh');
  });

  it('restores an Electron session from a refresh token even when no access token is cached', async () => {
    sessionStorage.setItem('refresh_token', 'refresh-only');
    const { api } = await import('../services/api');

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'fresh-token', refreshToken: 'refresh-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ _id: 'u1', username: 'tester' }),
      });

    const session = await api.restoreSession();

    expect(session).toEqual({
      user: { _id: 'u1', username: 'tester' },
      token: 'fresh-token',
      refreshToken: 'refresh-2',
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/auth/refresh');
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('/auth/me');
  });
});
