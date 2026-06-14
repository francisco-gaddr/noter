import { contextLevelConfig, normalizeContextLevel, CONTEXT_LEVELS, DEFAULT_CONTEXT_LEVEL } from './contextLevels';

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
});
