import { extractToolCalls } from './toolParsing';
import { formatToolFields } from './toolDescriptions';

describe('extractToolCalls (robust)', () => {
  it('parses a ```json fenced block', () => {
    const { calls } = extractToolCalls('Visst!\n```json\n{"tool":"create_task","arguments":{"title":"Ring"}}\n```');
    expect(calls).toEqual([{ tool: 'create_task', arguments: { title: 'Ring' } }]);
  });

  it('parses a plain ``` fence (no language tag)', () => {
    const { calls } = extractToolCalls('```\n{"tool":"list_tasks","arguments":{"completed":false}}\n```');
    expect(calls[0].tool).toBe('list_tasks');
  });

  it('parses BARE un-fenced JSON (the main "just chats" failure)', () => {
    const { calls, cleaned } = extractToolCalls('Jag skapar den nu. {"tool":"create_task","arguments":{"title":"Köp mjölk"}}');
    expect(calls).toEqual([{ tool: 'create_task', arguments: { title: 'Köp mjölk' } }]);
    expect(cleaned).toBe('Jag skapar den nu.');
  });

  it('parses an array of calls', () => {
    const { calls } = extractToolCalls('```json\n[{"tool":"create_project","arguments":{"title":"Hem"}},{"tool":"create_task","arguments":{"title":"A"}}]\n```');
    expect(calls.map((c) => c.tool)).toEqual(['create_project', 'create_task']);
  });

  it('unwraps an extra args/input/parameters level', () => {
    const { calls } = extractToolCalls('{"tool":"create_task","arguments":{"input":{"title":"X"}}}');
    expect(calls[0].arguments).toEqual({ title: 'X' });
  });

  it('ignores JSON that is not a tool call, and unknown tools', () => {
    expect(extractToolCalls('{"foo":1}').calls).toEqual([]);
    expect(extractToolCalls('{"tool":"rm_rf","arguments":{}}').calls).toEqual([]);
  });

  it('respects a custom allow-list', () => {
    const { calls } = extractToolCalls('{"tool":"create_task","arguments":{}}', new Set(['list_tasks']));
    expect(calls).toEqual([]);
  });
});

describe('formatToolFields', () => {
  it('renders readable label/value rows with date + priority + boolean formatting', () => {
    const rows = formatToolFields('Tool call: create_task {"title":"Ring tandläkaren","priority":"high","dueDate":"2026-07-01T09:00:00.000Z","delegateToAi":true}');
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel['Titel']).toBe('Ring tandläkaren');
    expect(byLabel['Prioritet']).toBe('Hög');
    expect(byLabel['Delegera till AI']).toBe('Ja');
    expect(byLabel['Förfaller']).toMatch(/2026/);
  });

  it('unwraps an args level and returns [] for non-object payloads', () => {
    expect(formatToolFields('Tool call: create_note {"args":{"title":"N"}}')).toEqual([{ label: 'Titel', value: 'N' }]);
    expect(formatToolFields('Tool result: list_tasks')).toEqual([]);
  });
});
