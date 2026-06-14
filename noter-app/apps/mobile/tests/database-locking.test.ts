/**
 * Regression tests for the "database is locked" fix: writes retry transient
 * SQLITE_BUSY, and bulk saves use an EXCLUSIVE transaction (not the interleaving
 * non-exclusive one). See services/database.ts.
 */
describe('mobile sqlite write concurrency', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const loadDb = (runAsyncImpl: jest.Mock) => {
    const withExclusiveTransactionAsync = jest.fn(async (cb: any) => cb());
    const withTransactionAsync = jest.fn(async (cb: any) => cb());
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: () => ({
        execAsync: jest.fn(async () => {}),
        runAsync: runAsyncImpl,
        getAllAsync: jest.fn(async () => []),
        getFirstAsync: jest.fn(async () => null),
        withTransactionAsync,
        withExclusiveTransactionAsync,
      }),
    }));
    let database: any;
    jest.isolateModules(() => { database = require('../services/database'); });
    return { database, withExclusiveTransactionAsync, withTransactionAsync };
  };

  it('withBusyRetry retries a transient "database is locked" then succeeds', async () => {
    let calls = 0;
    const runAsync = jest.fn(async () => {});
    const { database } = loadDb(runAsync);
    const result = await database.withBusyRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('database is locked');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('withBusyRetry rethrows a non-lock error immediately (no retry)', async () => {
    const { database } = loadDb(jest.fn(async () => {}));
    let calls = 0;
    await expect(
      database.withBusyRetry(async () => { calls += 1; throw new Error('syntax error'); })
    ).rejects.toThrow('syntax error');
    expect(calls).toBe(1);
  });

  it('a single write retries when runAsync reports a lock, then completes', async () => {
    let attempts = 0;
    const runAsync = jest.fn(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('Error code 5: database is locked');
    });
    const { database } = loadDb(runAsync);
    await database.deleteNoteLocal('note-1');
    expect(attempts).toBe(2);
    expect(runAsync).toHaveBeenLastCalledWith('DELETE FROM notes WHERE _id = ?', ['note-1']);
  });

  it('bulk save uses the EXCLUSIVE transaction (never the interleaving one)', async () => {
    const runAsync = jest.fn(async () => {});
    const { database, withExclusiveTransactionAsync, withTransactionAsync } = loadDb(runAsync);
    await database.saveNotesLocalBulk(
      [{ _id: 'n1', title: 'A', content: '', tags: [], createdAt: '', updatedAt: '', userId: 'u' }],
      true,
    );
    expect(withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(withTransactionAsync).not.toHaveBeenCalled();
  });
});
