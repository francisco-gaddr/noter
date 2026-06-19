import { contextLevelConfig, normalizeContextLevel, summarizeToolPolicy, CONTEXT_LEVELS, DEFAULT_CONTEXT_LEVEL, contextLevelRank, meetsMinContextLevel, boundChatHistory } from './contextLevels';

describe('boundChatHistory', () => {
  const m = (role: string, content: string) => ({ role, content });

  it('returns a short conversation unchanged', () => {
    const h = [m('system', 'persona'), m('user', 'hi'), m('assistant', 'hello'), m('user', 'thanks')];
    expect(boundChatHistory(h)).toEqual(h);
  });

  it('keeps all leading system messages + the most recent turns, dropping the oldest', () => {
    const big = 'x'.repeat(20000);
    const h = [
      m('system', 'persona'),
      m('user', `old ${big}`), m('assistant', `old ${big}`), // ~40k — should be dropped
      m('user', 'recent-1'), m('assistant', 'recent-2'), m('user', 'recent-3'),
    ];
    const out = boundChatHistory(h, { maxChars: 8000, minRecentTurns: 2 });
    expect(out[0]).toEqual(m('system', 'persona')); // system always kept
    const contents = out.map((x) => x.content);
    expect(contents).toContain('recent-3'); // newest kept
    expect(contents).toContain('recent-2');
    expect(out.some((x) => x.content.startsWith('old '))).toBe(false); // oldest dropped
  });

  it('over a tiny budget still yields a valid (user-first) non-empty history that keeps the final turn', () => {
    const huge = 'y'.repeat(100000);
    const h = [m('user', huge), m('assistant', huge), m('user', 'final')];
    const out = boundChatHistory(h, { maxChars: 1000, minRecentTurns: 2 });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].role).toBe('user'); // valid for first-must-be-user providers
    expect(out[out.length - 1].content).toBe('final'); // the current question is never dropped
  });

  it('honours minRecentTurns when the recent turns alternate normally', () => {
    const huge = 'y'.repeat(50000);
    const h = [m('user', `o ${huge}`), m('assistant', `o ${huge}`), m('user', 'r1'), m('assistant', 'r2'), m('user', 'r3')];
    const out = boundChatHistory(h, { maxChars: 2000, minRecentTurns: 3 });
    expect(out.map((x) => x.content)).toEqual(['r1', 'r2', 'r3']);
  });

  it('keeps the history valid for first-must-be-user providers (drops a leading assistant turn)', () => {
    const big = 'z'.repeat(20000);
    const h = [
      m('user', `u0 ${big}`), m('assistant', `a0 ${big}`),
      m('assistant', 'dangling'), m('user', 'final'),
    ];
    const out = boundChatHistory(h, { maxChars: 5000, minRecentTurns: 1 });
    expect(out[0].role).toBe('user'); // never starts on assistant/tool
  });

  it('tolerates junk input', () => {
    expect(boundChatHistory(null as any)).toEqual([]);
    expect(boundChatHistory([{ role: 'user' } as any])).toEqual([{ role: 'user' }]);
  });
});

describe('minContextLevel gate', () => {
  it('ranks levels in order', () => {
    expect(contextLevelRank('minimal')).toBe(0);
    expect(contextLevelRank('deep')).toBe(3);
    expect(contextLevelRank('bogus')).toBe(contextLevelRank('standard'));
  });
  it('an undefined/empty min always passes', () => {
    expect(meetsMinContextLevel('fast', undefined)).toBe(true);
    expect(meetsMinContextLevel('minimal', '')).toBe(true);
  });
  it('gates by rank', () => {
    expect(meetsMinContextLevel('deep', 'standard')).toBe(true);
    expect(meetsMinContextLevel('standard', 'standard')).toBe(true);
    expect(meetsMinContextLevel('fast', 'standard')).toBe(false);
    expect(meetsMinContextLevel('standard', 'deep')).toBe(false);
  });
});

describe('contextLevels', () => {
  it('minimal allows nothing — just answer', () => {
    const c = contextLevelConfig('minimal');
    expect(c).toMatchObject({ includeContainers: false, allowReadTools: false, allowFulltextSearch: false, allowWebSearch: false, allowVectorSearch: false, maxContextItems: 0 });
  });

  it('escalates capabilities up the levels', () => {
    const items = CONTEXT_LEVELS.map((l) => contextLevelConfig(l).maxContextItems);
    expect(items).toEqual([0, 10, 50, 200]); // strictly increasing
    expect(contextLevelConfig('fast').allowFulltextSearch).toBe(true);
    expect(contextLevelConfig('fast').allowVectorSearch).toBe(false);
    expect(contextLevelConfig('standard').includeContainers).toBe(true);
    expect(contextLevelConfig('deep').allowVectorSearch).toBe(true);
    expect(contextLevelConfig('deep').allowWebSearch).toBe(true);
  });

  it('defaults to standard for unknown/missing', () => {
    expect(contextLevelConfig(undefined).level).toBe('standard');
    expect(contextLevelConfig('bogus').level).toBe('standard');
    expect(normalizeContextLevel('bogus')).toBe(DEFAULT_CONTEXT_LEVEL);
    expect(normalizeContextLevel('deep')).toBe('deep');
  });

  describe('summarizeToolPolicy', () => {
    it('minimal grants no tools — just answer', () => {
      expect(summarizeToolPolicy('minimal')).toEqual(['Endast svara (inga verktyg)']);
    });

    it('deep lists vector/graph search + write tools (web search is reserved, NOT advertised)', () => {
      const caps = summarizeToolPolicy('deep');
      expect(caps).toEqual(expect.arrayContaining(['Vektor/graf-sök', 'Skapa/ändra uppgifter', 'Fritextsök']));
      // allowWebSearch is reserved/unimplemented — must NOT be claimed to the user or the model.
      expect(caps).not.toContain('Webbsök');
    });

    it('toolUse=false hard-disables read/write tools but leaves search', () => {
      const caps = summarizeToolPolicy('standard', false);
      expect(caps).not.toContain('Skapa/ändra uppgifter');
      expect(caps).not.toContain('Läsa anteckningar/uppgifter');
      expect(caps).toContain('Fritextsök');
    });
  });
});
