import { buildChatSystemPrompt, buildDefaultChatBasePrompt, DEFAULT_CHAT_BASE_PROMPT } from './chatPrompt';

describe('buildChatSystemPrompt', () => {
  it('uses a strong, specific base role by default (never the empty "helpful assistant")', () => {
    const p = buildChatSystemPrompt();
    expect(p).toContain('# Roll');
    expect(p).toContain('anteckningar och uppgifter');
    expect(p).toContain('# Integritet'); // the locked-content rule is always present
  });

  it('layers user + project + tools + context in the fixed precedence, each labeled', () => {
    const p = buildChatSystemPrompt({
      userPrompt: 'Var kortfattad och formell.',
      projectPrompt: 'Detta projekt gäller bokföring.',
      toolGuidance: 'Använd search_notes för att hitta fakta.',
      contextNotices: ['Kontextnivå: Full.', 'Tid: 2026-07-11.'],
    });
    const iRole = p.indexOf('# Roll');
    const iUser = p.indexOf('# Användarens instruktioner');
    const iProject = p.indexOf('# Projekt');
    const iTools = p.indexOf('# Verktyg');
    const iContext = p.indexOf('# Kontext');
    // All present…
    expect([iRole, iUser, iProject, iTools, iContext].every((i) => i >= 0)).toBe(true);
    // …and in order (base → user → project → tools → context).
    expect(iRole).toBeLessThan(iUser);
    expect(iUser).toBeLessThan(iProject);
    expect(iProject).toBeLessThan(iTools);
    expect(iTools).toBeLessThan(iContext);
    expect(p).toContain('Var kortfattad och formell.');
    expect(p).toContain('Detta projekt gäller bokföring.');
  });

  it('omits empty layers entirely (no dangling headers)', () => {
    const p = buildChatSystemPrompt({ userPrompt: '   ', projectPrompt: '', contextNotices: ['', null, undefined] });
    expect(p).not.toContain('# Användarens instruktioner');
    expect(p).not.toContain('# Projekt');
    expect(p).not.toContain('# Kontext');
    expect(p).toContain('# Roll'); // base still there
  });

  it('does not double-label tool guidance that already starts with a heading', () => {
    const p = buildChatSystemPrompt({ toolGuidance: '# Verktyg (avancerat)\nRegler…' });
    expect(p).toContain('# Verktyg (avancerat)');
    expect(p).not.toContain('# Verktyg\n# Verktyg'); // no wrapper duplication
  });

  it('honours a custom base and assistant name', () => {
    expect(buildChatSystemPrompt({ base: 'CUSTOM BASE' }).startsWith('CUSTOM BASE')).toBe(true);
    expect(buildDefaultChatBasePrompt('Daylited')).toContain('Dayliteds AI-assistent');
    expect(DEFAULT_CHAT_BASE_PROMPT).toContain('Noters AI-assistent');
  });

  it('never throws on non-string inputs', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildChatSystemPrompt({ userPrompt: 123 as any, contextNotices: [42 as any] })).not.toThrow();
  });
});
