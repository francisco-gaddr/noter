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
});
