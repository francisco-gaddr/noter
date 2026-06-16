import { retrieveContext, renderRetrievedContext, type RetrievalCandidate } from './retrieval';

// A small, deterministic corpus. Vectors are hand-made so cosine similarity is obvious:
// "fishing" notes point along [1,0,0], "cooking" along [0,1,0], "budget" along [0,0,1].
const C = (id: string, kind: any, title: string, text: string, vector?: number[]): RetrievalCandidate =>
  ({ id, kind, title, text, vector });

const corpus: RetrievalCandidate[] = [
  C('a', 'note', 'Fiskeresa till sjön', 'Vi planerar en fiskeresa med metspö och båt.', [1, 0, 0]),
  C('b', 'note', 'Bästa betet', 'Maskar och spinnare funkar bäst för abborre.', [0.9, 0.1, 0]),
  C('c', 'note', 'Receptsamling', 'Pasta, soppa och en god gryta för helgen.', [0, 1, 0]),
  C('d', 'task', 'Köp metspö', 'Handla nytt metspö och linor inför resan.', [0.8, 0, 0]),
  C('e', 'note', 'Budget 2026', 'Sparande, utgifter och en plan för året.', [0, 0, 1]),
];

describe('retrieveContext (two-stage RAG: recall → rerank, + GraphRAG)', () => {
  it('lexical recall ranks the title match first', () => {
    const res = retrieveContext({ query: 'fiskeresa', candidates: corpus, options: { useVector: false } });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].id).toBe('a'); // exact title term
    expect(res[0].via).toContain('fulltext');
  });

  it('dense (vector) recall surfaces semantically-close items even without lexical overlap', () => {
    // Query vector points along the "fishing" axis; query text has NO lexical overlap.
    const res = retrieveContext({
      query: 'utomhusaktivitet vid vatten',
      queryVector: [1, 0, 0],
      candidates: corpus,
      options: { useFulltext: false, useRerank: false, limit: 3 },
    });
    const ids = res.map((r) => r.id);
    expect(ids).toContain('a'); // [1,0,0]
    expect(ids).toContain('d'); // [0.8,0,0]
    expect(ids).not.toContain('e'); // budget axis — far away
    expect(res.every((r) => r.via.includes('vector'))).toBe(true);
  });

  it('hybrid (fulltext + vector → RRF) fuses both rungs', () => {
    const res = retrieveContext({ query: 'metspö', queryVector: [1, 0, 0], candidates: corpus, options: { useRerank: false, limit: 4 } });
    const ids = res.map((r) => r.id);
    expect(ids).toContain('d'); // lexical "metspö" + vector
    // an item surfaced by BOTH rungs records both provenances
    const d = res.find((r) => r.id === 'd');
    expect(d?.via.sort()).toEqual(['fulltext', 'vector']);
  });

  it('rerank reorders the pool by query-aware precision (coverage + title + phrase)', () => {
    // Two candidates both contain the terms, but only one has the exact phrase in the title.
    const cands = [
      C('x', 'note', 'Diverse anteckningar', 'projekt alfa nämns en gång här bland mycket annat text text text', [0, 0, 0]),
      C('y', 'note', 'Projekt Alfa', 'projekt alfa: full sammanfattning av projekt alfa', [0, 0, 0]),
    ];
    const res = retrieveContext({ query: 'projekt alfa', candidates: cands, options: { useVector: false, useRerank: true } });
    expect(res[0].id).toBe('y'); // title + exact phrase wins after rerank
  });

  it('GraphRAG expansion pulls in a neighbour that did NOT match the query', () => {
    // 'z' has zero lexical/vector match, but is a graph neighbour of the top hit 'a'.
    const cands = corpus.concat([C('z', 'task', 'Boka stuga', 'Boka övernattning.', [0, 0, 0.0])]);
    const neighbors: Record<string, string[]> = { a: ['z'], z: ['a'] };
    const withGraph = retrieveContext({
      query: 'fiskeresa', candidates: cands,
      getNeighbors: (id) => neighbors[id] || [],
      options: { useVector: false, useGraphExpansion: true, limit: 5, useRerank: false },
    });
    const withoutGraph = retrieveContext({
      query: 'fiskeresa', candidates: cands,
      options: { useVector: false, useGraphExpansion: false, limit: 5, useRerank: false },
    });
    expect(withoutGraph.map((r) => r.id)).not.toContain('z');
    const z = withGraph.find((r) => r.id === 'z');
    expect(z).toBeTruthy();
    expect(z?.via).toContain('graph');
  });

  it('respects limit and returns provenance', () => {
    const res = retrieveContext({ query: 'fiske metspö resa', queryVector: [1, 0, 0], candidates: corpus, options: { limit: 2 } });
    expect(res.length).toBeLessThanOrEqual(2);
    expect(res[0].via.length).toBeGreaterThan(0);
  });

  it('SECURITY: only operates on the candidates it is given (locked items are never passed in)', () => {
    // The caller filters locked content out; a graph neighbour that is NOT among the
    // candidates (e.g. a locked note) is never surfaced even if a seed points to it.
    const neighbors: Record<string, string[]> = { a: ['LOCKED_NOTE'] };
    const res = retrieveContext({
      query: 'fiskeresa', candidates: corpus, // 'LOCKED_NOTE' deliberately absent
      getNeighbors: (id) => neighbors[id] || [],
      options: { useGraphExpansion: true, useVector: false },
    });
    expect(res.map((r) => r.id)).not.toContain('LOCKED_NOTE');
  });

  it('returns [] for empty query or empty corpus', () => {
    expect(retrieveContext({ query: '', candidates: corpus })).toEqual([]);
    expect(retrieveContext({ query: 'fiske', candidates: [] })).toEqual([]);
  });

  it('renderRetrievedContext produces a bounded, tagged prompt block', () => {
    const res = retrieveContext({ query: 'fiskeresa', candidates: corpus, options: { useVector: false, limit: 2 } });
    const block = renderRetrievedContext(res, 2000);
    expect(block).toContain('<relevant_kontext');
    expect(block).toContain('Fiskeresa');
    expect(block.length).toBeLessThanOrEqual(2200);
    expect(renderRetrievedContext([])).toBe('');
  });
});
