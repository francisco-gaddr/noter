import { combineSystemPrompts } from '../services/ai/prompt';

describe('AI prompt', () => {
  it('combines main and project prompts', () => {
    const combined = combineSystemPrompts('Main prompt', 'Project prompt');
    expect(combined).toBe('Main prompt\n\nProject prompt');
  });

  it('handles missing prompts', () => {
    expect(combineSystemPrompts('', 'Project')).toBe('Project');
    expect(combineSystemPrompts('Main', '')).toBe('Main');
    expect(combineSystemPrompts('', '')).toBe('');
  });
});
