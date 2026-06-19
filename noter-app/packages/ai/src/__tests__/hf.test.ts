import { sortModels, HuggingFaceService, fetchWithTimeout, type HFModel } from '../hf';

const m = (over: Partial<HFModel>): HFModel => ({
  id: over.id || 'a/b', author: 'a', name: 'b', downloads: 0, likes: 0, tags: [], ...over,
});

describe('sortModels', () => {
  const models: HFModel[] = [
    m({ id: 'x/low', downloads: 10, likes: 5, createdAt: '2024-01-01T00:00:00Z' }),
    m({ id: 'y/mid', downloads: 100, likes: 1, createdAt: '2026-06-01T00:00:00Z' }),
    m({ id: 'z/high', downloads: 50, likes: 99, createdAt: '2025-03-01T00:00:00Z' }),
  ];

  it('sorts by downloads desc', () => {
    expect(sortModels(models, 'downloads').map((x) => x.id)).toEqual(['y/mid', 'z/high', 'x/low']);
  });

  it('sorts by likes (rating) desc', () => {
    expect(sortModels(models, 'likes').map((x) => x.id)).toEqual(['z/high', 'x/low', 'y/mid']);
  });

  it('sorts by release date (recent) desc', () => {
    expect(sortModels(models, 'recent').map((x) => x.id)).toEqual(['y/mid', 'z/high', 'x/low']);
  });

  it('does not mutate the input array', () => {
    const input = [...models];
    sortModels(input, 'likes');
    expect(input.map((x) => x.id)).toEqual(['x/low', 'y/mid', 'z/high']);
  });

  it('puts missing createdAt last when sorting by recent', () => {
    const withMissing: HFModel[] = [m({ id: 'no/date' }), m({ id: 'has/date', createdAt: '2025-01-01T00:00:00Z' })];
    expect(sortModels(withMissing, 'recent').map((x) => x.id)).toEqual(['has/date', 'no/date']);
  });
});

describe('HuggingFaceService network resilience', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  it('searchModels bounds the call with an abort signal and maps results', async () => {
    const fetchMock = jest.fn(async (_url: string, init: any) => {
      expect(init.signal).toBeInstanceOf(AbortSignal); // proves the timeout is wired
      return { ok: true, json: async () => [{ id: 'a/b', author: 'a', downloads: 1, likes: 2, tags: [] }] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await new HuggingFaceService().searchModels('q');
    expect(res[0].id).toBe('a/b');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getModelFiles returns [] when the upstream rejects (never crashes the picker)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    expect(await new HuggingFaceService().getModelFiles('a/b')).toEqual([]);
  });

  it('fetchWithTimeout aborts a request that never responds', async () => {
    global.fetch = jest.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    await expect(fetchWithTimeout('http://example.test', {}, 10)).rejects.toBeTruthy();
  });
});
