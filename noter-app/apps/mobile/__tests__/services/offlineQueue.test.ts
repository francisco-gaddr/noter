jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => undefined),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  },
}));

import {
  enqueue,
  pending,
  flush,
  clear,
  setOfflineQueueExecutor,
  _resetForTests,
} from '../../services/offlineQueue';

beforeEach(async () => {
  _resetForTests();
  await clear();
});

describe('offlineQueue', () => {
  it('enqueues a mutation and exposes it via pending()', async () => {
    await enqueue({ resource: 'note', op: 'create', id: 'n1', payload: { title: 'A' } });
    const p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ resource: 'note', op: 'create', id: 'n1' });
    expect(p[0].queuedAt).toMatch(/^\d{4}-/);
    expect(p[0].attempts).toBe(0);
  });

  it('dedupes by (resource,id,op) — latest payload wins', async () => {
    await enqueue({ resource: 'note', op: 'update', id: 'n1', payload: { title: 'v1' } });
    await enqueue({ resource: 'note', op: 'update', id: 'n1', payload: { title: 'v2' } });
    const p = await pending();
    expect(p).toHaveLength(1);
    expect((p[0].payload as any).title).toBe('v2');
  });

  it('delete after update collapses to just delete', async () => {
    await enqueue({ resource: 'note', op: 'update', id: 'n1', payload: { title: 'updated' } });
    await enqueue({ resource: 'note', op: 'delete', id: 'n1' });
    const p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0].op).toBe('delete');
  });

  it('flush() processes items in order, removes them on success', async () => {
    const calls: string[] = [];
    setOfflineQueueExecutor(async (m) => { calls.push(m.id); });
    await enqueue({ resource: 'note', op: 'create', id: 'a' });
    await enqueue({ resource: 'note', op: 'create', id: 'b' });
    const result = await flush();
    expect(result).toEqual({ flushed: 2, failed: 0, dropped: 0 });
    expect(calls).toEqual(['a', 'b']);
    expect(await pending()).toHaveLength(0);
  });

  it('flush() stops on first failure and increments attempts', async () => {
    setOfflineQueueExecutor(async () => { throw new Error('network down'); });
    await enqueue({ resource: 'note', op: 'create', id: 'a' });
    await enqueue({ resource: 'note', op: 'create', id: 'b' });
    const result = await flush();
    expect(result.flushed).toBe(0);
    expect(result.failed).toBe(1);
    const p = await pending();
    expect(p[0].attempts).toBe(1);
    expect(p).toHaveLength(2);
  });

  it('flush() drops items after MAX_ATTEMPTS failures', async () => {
    setOfflineQueueExecutor(async () => { throw new Error('always fails'); });
    await enqueue({ resource: 'note', op: 'create', id: 'a' });
    // 5 flush attempts → attempts goes 1,2,3,4,5 — on the 5th the item is dropped.
    for (let i = 0; i < 5; i++) await flush();
    const p = await pending();
    expect(p).toHaveLength(0);
  });

  it('flush is a no-op when no executor is registered', async () => {
    setOfflineQueueExecutor(null as any);
    _resetForTests();
    await clear();
    const result = await flush();
    expect(result).toEqual({ flushed: 0, failed: 0, dropped: 0 });
  });
});
