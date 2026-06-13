import { normalizeToolArguments } from '../toolArgs';

describe('normalizeToolArguments', () => {
  it('passes flat args through unchanged', () => {
    const flat = { title: 'Springa', dueDate: '2026-06-14T11:00:00.000Z', reminderEnabled: true };
    expect(normalizeToolArguments('create_task', flat)).toEqual(flat);
  });

  it('unwraps a stray args wrapper and keeps top-level siblings (the reported bug)', () => {
    const wrapped = {
      args: { title: 'Springa', description: 'Påminnelse om att springa', dueDate: '2026-06-14T11:00:00.000Z', reminderEnabled: true, reminderOffsetMinutes: 0 },
      parentNoteId: '69a3209b994615f30b0a4946',
      priority: 'medium',
    };
    expect(normalizeToolArguments('create_task', wrapped)).toEqual({
      title: 'Springa',
      description: 'Påminnelse om att springa',
      dueDate: '2026-06-14T11:00:00.000Z',
      reminderEnabled: true,
      reminderOffsetMinutes: 0,
      parentNoteId: '69a3209b994615f30b0a4946',
      priority: 'medium',
    });
  });

  it('unwraps a stray args wrapper for create_note', () => {
    const wrapped = { args: { title: 'Kakrecept', content: 'Blanda…', type: 'note' } };
    expect(normalizeToolArguments('create_note', wrapped)).toEqual({ title: 'Kakrecept', content: 'Blanda…', type: 'note' });
  });

  it('unwraps input/parameters wrappers too', () => {
    expect(normalizeToolArguments('create_note', { input: { title: 'A' } })).toEqual({ title: 'A' });
    expect(normalizeToolArguments('create_task', { parameters: { title: 'B' } })).toEqual({ title: 'B' });
  });

  it('preserves the legitimate updates object for update_* tools', () => {
    const a = { id: 'x', updates: { title: 'New' } };
    expect(normalizeToolArguments('update_note', a)).toEqual(a);
  });

  it('unwraps a wrapped update payload but keeps updates nested', () => {
    expect(normalizeToolArguments('update_task', { args: { id: 'x', updates: { completed: true } } }))
      .toEqual({ id: 'x', updates: { completed: true } });
  });

  it('does NOT unwrap args for mcp_call_tool (args is a real parameter)', () => {
    const a = { service: 'googleWorkspace', toolName: 'create_event', args: { summary: 'Möte' } };
    expect(normalizeToolArguments('mcp_call_tool', a)).toEqual(a);
  });

  it('returns {} for non-object input', () => {
    expect(normalizeToolArguments('create_task', null)).toEqual({});
    expect(normalizeToolArguments('create_task', [1, 2])).toEqual({});
    expect(normalizeToolArguments('create_task', 'x')).toEqual({});
  });

  it('does not unwrap array-valued keys (e.g. tags)', () => {
    const a = { title: 'A', tags: ['x', 'y'] };
    expect(normalizeToolArguments('create_note', a)).toEqual(a);
  });
});
