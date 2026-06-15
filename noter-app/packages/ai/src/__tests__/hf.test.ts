import { sortModels, type HFModel } from '../hf';

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
