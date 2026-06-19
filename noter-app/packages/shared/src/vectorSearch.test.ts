import { cosineSimilarity, vectorSearch, reciprocalRankFusion, hybridSearch } from './vectorSearch';
import type { SearchHit } from './graphModel';

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal/empty', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('is 0 for mismatched dimensions (incompatible models) — never a truncated garbage score', () => {
    // A 1024-dim query vs a stale 768-dim stored vector: must score 0, not silently truncate.
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 1, 1, 1])).toBe(0);
  });
});

describe('vectorSearch — dimension safety', () => {
  it('excludes stored vectors whose dimension differs from the query (stale index → lexical fallback)', () => {
    const query = [1, 0, 0]; // current model: 3-dim
    const items = [
      { id: 'new', kind: 'note' as const, title: 'N', vector: [1, 0, 0] }, // same model
      { id: 'stale', kind: 'note' as const, title: 'S', vector: [1, 0] },  // old model, 2-dim
    ];
    const hits = vectorSearch(query, items);
    expect(hits.map((h) => h.id)).toEqual(['new']); // the incompatible vector is dropped, not ranked
  });
});

describe('vectorSearch', () => {
  const items = [
    { id: 'a', kind: 'note' as const, title: 'A', vector: [1, 0, 0] },
    { id: 'b', kind: 'note' as const, title: 'B', vector: [0.9, 0.1, 0] },
    { id: 'c', kind: 'task' as const, title: 'C', vector: [0, 1, 0] },
  ];
  it('ranks by cosine similarity to the query', () => {
    const hits = vectorSearch([1, 0, 0], items, 10);
    expect(hits[0].id).toBe('a');
    expect(hits[1].id).toBe('b');
    expect(hits.find((h) => h.id === 'c')).toBeUndefined(); // orthogonal → score 0, dropped
  });
  it('returns [] for an empty query vector', () => {
    expect(vectorSearch([], items)).toEqual([]);
  });
});

describe('reciprocalRankFusion (k=60)', () => {
  it('rewards consensus across lists', () => {
    const ft = [{ id: 'x' }, { id: 'y' }];
    const vec = [{ id: 'y' }, { id: 'z' }];
    const fused = reciprocalRankFusion([ft, vec], 60);
    // y appears in both → highest fused score
    const top = [...fused.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(top).toBe('y');
    expect(fused.get('y')!).toBeCloseTo(1 / 62 + 1 / 61);
  });
});

describe('hybridSearch', () => {
  it('fuses fulltext + vector and flags provenance', () => {
    const ft: SearchHit[] = [{ id: 'a', kind: 'note', title: 'A', score: 5, snippet: 'sa' }];
    const vec = [{ id: 'a', kind: 'note', title: 'A', score: 0.9 }, { id: 'b', kind: 'task', title: 'B', score: 0.8 }];
    const out = hybridSearch(ft, vec, 10);
    const a = out.find((h) => h.id === 'a')!;
    expect(a.inFulltext).toBe(true);
    expect(a.inVector).toBe(true);
    expect(a.snippet).toBe('sa'); // fulltext snippet preserved
    expect(out.find((h) => h.id === 'b')!.inFulltext).toBe(false);
    expect(out[0].id).toBe('a'); // in both → ranks first
  });
  it('degrades to whichever rung is present', () => {
    const ft: SearchHit[] = [{ id: 'a', kind: 'note', title: 'A', score: 1 }];
    expect(hybridSearch(ft, [], 10).map((h) => h.id)).toEqual(['a']);
    expect(hybridSearch([], [{ id: 'b', kind: 'task', title: 'B', score: 0.5 }], 10).map((h) => h.id)).toEqual(['b']);
  });
});
