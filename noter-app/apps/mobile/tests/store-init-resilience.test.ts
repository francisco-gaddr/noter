describe('store init resilience', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('marks startup as initialized and exposes an error when database init fails', async () => {
    jest.doMock('react-native-get-random-values', () => ({}));
    jest.doMock('../services/api', () => ({
      fetchWithAuth: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      setAuthToken: jest.fn(),
      initApiUrl: jest.fn(async () => undefined),
      setUnauthorizedHandler: jest.fn(),
    }));
    jest.doMock('../services/database', () => ({
      initDatabase: jest.fn(async () => {
        throw new Error('db unavailable');
      }),
      migrateLocalEncryptedData: jest.fn(async () => undefined),
      getNotesLocal: jest.fn(async () => []),
      getTasksLocal: jest.fn(async () => []),
    }));
    jest.doMock('../services/socket', () => ({
      initSocket: jest.fn(),
      disconnectSocket: jest.fn(),
      getSocket: jest.fn(),
    }));
    jest.doMock('../services/notifications', () => ({
      scheduleTaskReminder: jest.fn(),
      cancelTaskReminder: jest.fn(),
      cancelAllTaskReminders: jest.fn(),
    }));
    jest.doMock('../services/ai/security', () => ({
      buildSecurityNoteMap: jest.fn(() => new Map()),
      findBlockingLockedAncestor: jest.fn(() => null),
    }));
    jest.doMock('../services/i18n', () => ({
      __esModule: true,
      default: {
        t: (key: string) => key,
      },
    }));
    jest.doMock('../services/encryptionKey', () => ({
      initLocalEncryptionKey: jest.fn(async () => undefined),
    }));
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: {
        addEventListener: jest.fn(() => jest.fn()),
      },
    }));

    const { useStore } = require('../stores/useStore');

    await useStore.getState().init();

    expect(useStore.getState().isInitialized).toBe(true);
    expect(useStore.getState().error).toBe('db unavailable');
    expect(useStore.getState().notes).toEqual([]);
    expect(useStore.getState().tasks).toEqual([]);
  });

  it('deduplicates parallel init calls into a single bootstrap', async () => {
    jest.useFakeTimers();
    const initApiUrl = jest.fn(async () => undefined);
    const initDatabase = jest.fn(async () => undefined);
    const migrateLocalEncryptedData = jest.fn(async () => undefined);
    const addEventListener = jest.fn(() => jest.fn());

    jest.doMock('react-native-get-random-values', () => ({}));
    jest.doMock('../services/api', () => ({
      fetchWithAuth: jest.fn(async () => []),
      login: jest.fn(),
      register: jest.fn(),
      setAuthToken: jest.fn(),
      initApiUrl,
      setUnauthorizedHandler: jest.fn(),
    }));
    jest.doMock('../services/database', () => ({
      initDatabase,
      migrateLocalEncryptedData,
      getNotesLocal: jest.fn(async () => []),
      getTasksLocal: jest.fn(async () => []),
    }));
    jest.doMock('../services/socket', () => ({
      initSocket: jest.fn(() => ({ off: jest.fn(), on: jest.fn() })),
      disconnectSocket: jest.fn(),
      getSocket: jest.fn(),
    }));
    jest.doMock('../services/notifications', () => ({
      scheduleTaskReminder: jest.fn(),
      cancelTaskReminder: jest.fn(),
      cancelAllTaskReminders: jest.fn(),
      syncAllTaskReminders: jest.fn(),
    }));
    jest.doMock('../services/ai/security', () => ({
      buildSecurityNoteMap: jest.fn(() => new Map()),
      findBlockingLockedAncestor: jest.fn(() => null),
    }));
    jest.doMock('../services/i18n', () => ({
      __esModule: true,
      default: {
        t: (key: string) => key,
      },
    }));
    jest.doMock('../services/encryptionKey', () => ({
      initLocalEncryptionKey: jest.fn(async () => undefined),
    }));
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: {
        addEventListener,
        fetch: jest.fn(async () => ({ isConnected: false })),
      },
    }));
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async () => 'token-1'),
      deleteItemAsync: jest.fn(async () => undefined),
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
    }));

    const { useStore } = require('../stores/useStore');

    await Promise.all([
      useStore.getState().init(),
      useStore.getState().init(),
    ]);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    expect(initApiUrl).toHaveBeenCalledTimes(1);
    expect(initDatabase).toHaveBeenCalledTimes(1);
    expect(migrateLocalEncryptedData).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it('reloads collections and reconnects socket on login after initialized session', async () => {
    jest.useFakeTimers();
    const fetchWithAuth = jest.fn(async (path: string) => {
      if (path === '/notes') return [];
      if (path === '/tasks') return [];
      return [];
    });
    const apiLogin = jest.fn(async () => ({ token: 'fresh-token' }));
    const initSocket = jest.fn(() => ({ connected: true, off: jest.fn(), on: jest.fn() }));

    jest.doMock('react-native-get-random-values', () => ({}));
    jest.doMock('../services/api', () => ({
      fetchWithAuth,
      login: apiLogin,
      register: jest.fn(),
      setAuthToken: jest.fn(),
      initApiUrl: jest.fn(async () => undefined),
      setUnauthorizedHandler: jest.fn(),
    }));
    jest.doMock('../services/database', () => ({
      initDatabase: jest.fn(async () => undefined),
      migrateLocalEncryptedData: jest.fn(async () => undefined),
      getNotesLocal: jest.fn(async () => []),
      getTasksLocal: jest.fn(async () => []),
      saveNoteLocal: jest.fn(async () => undefined),
      saveTaskLocal: jest.fn(async () => undefined),
    }));
    jest.doMock('../services/socket', () => ({
      initSocket,
      disconnectSocket: jest.fn(),
      getSocket: jest.fn(),
    }));
    jest.doMock('../services/notifications', () => ({
      scheduleTaskReminder: jest.fn(),
      cancelTaskReminder: jest.fn(),
      cancelAllTaskReminders: jest.fn(),
      syncAllTaskReminders: jest.fn(),
    }));
    jest.doMock('../services/ai/security', () => ({
      buildSecurityNoteMap: jest.fn(() => new Map()),
      findBlockingLockedAncestor: jest.fn(() => null),
    }));
    jest.doMock('../services/i18n', () => ({
      __esModule: true,
      default: {
        t: (key: string) => key,
      },
    }));
    jest.doMock('../services/encryptionKey', () => ({
      initLocalEncryptionKey: jest.fn(async () => undefined),
    }));
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: {
        addEventListener: jest.fn(() => jest.fn()),
        fetch: jest.fn(async () => ({ isConnected: true })),
      },
    }));
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
      deleteItemAsync: jest.fn(async () => undefined),
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
    }));

    const { useStore } = require('../stores/useStore');
    useStore.setState({ isInitialized: true, securityLocked: false });

    await useStore.getState().login('demo', 'secret');
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    expect(apiLogin).toHaveBeenCalledWith('demo', 'secret');
    expect(fetchWithAuth).toHaveBeenCalledWith('/notes', { timeoutMs: 45000 });
    expect(fetchWithAuth).toHaveBeenCalledWith('/tasks', { timeoutMs: 30000 });
    expect(initSocket).toHaveBeenCalledWith('fresh-token');
  });
});
