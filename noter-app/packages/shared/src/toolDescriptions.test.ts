import { parseToolMessage, describeTool, describeToolResult, summarizeToolMessage } from './toolDescriptions';

describe('parseToolMessage', () => {
  it('parses a call with JSON args', () => {
    const p = parseToolMessage('Tool call: create_task {"args":{"title":"Ring tandläkaren"}}');
    expect(p.kind).toBe('call');
    expect(p.tool).toBe('create_task');
    expect(p.payload.args.title).toBe('Ring tandläkaren');
  });
  it('parses result + error kinds', () => {
    expect(parseToolMessage('Tool result: list_tasks {"entitiesRead":[1,2]}').kind).toBe('result');
    expect(parseToolMessage('Tool error: get_note hittades inte').kind).toBe('error');
  });
  it('falls back for non-tool content', () => {
    expect(parseToolMessage('hej').kind).toBe('tool');
  });
});

describe('describeTool', () => {
  it('reads, lists, creates, updates, deletes with human phrasing', () => {
    expect(describeTool('get_note', { args: { title: 'Recept' } }).summary).toBe('Läste anteckning: Recept');
    expect(describeTool('list_tasks').summary).toContain('uppgifter');
    expect(describeTool('create_task', { args: { title: 'X' } }).summary).toBe('Skapade uppgift: X');
    expect(describeTool('update_note', { args: { id: 'n1' } }).summary).toBe('Uppdaterade anteckning');
    expect(describeTool('delete_task', { args: { title: 'Y' } }).summary).toBe('Tog bort uppgift: Y');
  });
  it('flags an AI-delegated create', () => {
    expect(describeTool('create_task', { args: { title: 'Z', delegateToAi: true } }).summary).toContain('delegerad till AI-agent');
  });
  it('describes MCP / other-agent calls', () => {
    expect(describeTool('mcp_call_tool', { args: { service: 'googleWorkspace', toolName: 'create_event' } }).summary).toBe('Anropade googleWorkspace · create_event');
    expect(describeTool('mcp_list_tools', { args: { service: 'github' } }).category).toBe('mcp');
  });
  it('maps categories correctly', () => {
    expect(describeTool('create_project').category).toBe('project');
    expect(describeTool('list_tasklists').category).toBe('list');
  });
});

describe('describeToolResult + summarizeToolMessage', () => {
  it('counts entities read', () => {
    expect(describeToolResult('list_tasks', { entitiesRead: [1, 2, 3] })).toBe('Läste 3 poster');
    expect(describeToolResult('list_tasks', { entitiesRead: [1] })).toBe('Läste 1 post');
  });
  it('never returns empty — always a phrase from the message', () => {
    expect(summarizeToolMessage('Tool call: create_task {"args":{"title":"A"}}').summary).toBe('Skapade uppgift: A');
    expect(summarizeToolMessage('Tool result: get_note {"result":{"note":{"title":"B"}}}').summary).toBeTruthy();
    expect(summarizeToolMessage('Tool error: get_task saknas').summary).toContain('Fel i get_task');
    expect(summarizeToolMessage('weird').summary).toBeTruthy();
  });
});
