/**
 * Regression guard for the offline sync queue (ADR-0004).
 *
 * `addToSyncQueue` carries the FULL entity state as its payload, so a second
 * offline edit of the same note/task must REPLACE the queued item (latest-wins).
 * The old `INSERT OR IGNORE` silently kept the stale first edit; the post-sync
 * `fetchNotes`/`fetchTasks` then overwrote the newer local copy, losing the
 * second edit. The dedupe must collapse on `dedupeKeyHash` via an UPSERT.
 *
 * This asserts the emitted SQL shape (not runtime SQLite) because the suite
 * mocks `expo-sqlite`. It is deliberately standalone — it does not depend on
 * the shared `makeDb` helper in tests/database-at-rest.test.ts.
 */

const makeDb = () => {
  const runAsync = jest.fn(async () => {});
  jest.doMock('expo-sqlite', () => ({
    openDatabaseSync: () => ({
      execAsync: jest.fn(async () => {}),
      runAsync,
      getAllAsync: jest.fn(async () => []),
      getFirstAsync: jest.fn(async () => null),
      withTransactionAsync: jest.fn(async (cb: any) => cb()),
    }),
  }));
  let database: any;
  jest.isolateModules(() => { database = require('../../services/database'); });
  return { database, runAsync };
};

const lastSyncQueueSql = (runAsync: jest.Mock): string => {
  const call = (runAsync.mock.calls as any[][]).find((c) =>
    String(c?.[0] || '').includes('INTO sync_queue')
  );
  return String(call?.[0] || '');
};

describe('offline sync_queue upsert (latest-wins)', () => {
  beforeEach(() => jest.resetModules());

  it('uses ON CONFLICT … DO UPDATE, never INSERT OR IGNORE', async () => {
    const { database, runAsync } = makeDb();
    await database.addToSyncQueue('UPDATE', 'NOTE', { id: 'srv_1', title: 'v2' });
    const sql = lastSyncQueueSql(runAsync);
    expect(sql).toContain('INTO sync_queue');
    expect(sql).not.toContain('OR IGNORE');
    expect(sql).toContain('ON CONFLICT(dedupeKeyHash)');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('resets the retry counter on a fresh enqueue (a new edit is a new intent)', async () => {
    const { database, runAsync } = makeDb();
    await database.addToSyncQueue('UPDATE', 'TASK', { id: 'srv_2', title: 'v2' });
    expect(lastSyncQueueSql(runAsync)).toContain('attempts = 0');
  });
});
