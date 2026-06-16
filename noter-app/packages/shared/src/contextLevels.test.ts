import { contextLevelConfig, normalizeContextLevel, summarizeToolPolicy, CONTEXT_LEVELS, DEFAULT_CONTEXT_LEVEL, contextLevelRank, meetsMinContextLevel } from './contextLevels';

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

    it('deep lists the full set including web + vector/graph search', () => {
      const caps = summarizeToolPolicy('deep');
      expect(caps).toEqual(expect.arrayContaining(['Webbsök', 'Vektor/graf-sök', 'Skapa/ändra uppgifter']));
    });

    it('toolUse=false hard-disables read/write tools but leaves search', () => {
      const caps = summarizeToolPolicy('standard', false);
      expect(caps).not.toContain('Skapa/ändra uppgifter');
      expect(caps).not.toContain('Läsa anteckningar/uppgifter');
      expect(caps).toContain('Fritextsök');
    });
  });
});
