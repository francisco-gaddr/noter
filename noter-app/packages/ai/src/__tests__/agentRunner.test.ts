import { runAgentTask, parseAgentToolCalls, type AgentRunDeps } from '../agentRunner';

const baseDeps = (over: Partial<AgentRunDeps> = {}): AgentRunDeps => ({
  invokeModel: async () => 'done',
  executeTool: async () => ({ ok: true }),
  now: () => '2026-06-14T11:00:00.000Z',
  ...over,
});

describe('parseAgentToolCalls', () => {
  it('parses a json tool block and unwraps stray args', () => {
    const calls = parseAgentToolCalls('text\n```json\n{"tool":"create_task","arguments":{"args":{"title":"X"}}}\n```');
    expect(calls).toEqual([{ tool: 'create_task', arguments: { title: 'X' } }]);
  });

  it('returns [] when there is no tool block', () => {
    expect(parseAgentToolCalls('just a plain answer')).toEqual([]);
  });
});

describe('runAgentTask', () => {
  it('runs tools then stops when the model gives a plain answer', async () => {
    const script = [
      '```json\n{"tool":"list_tasks","arguments":{}}\n```',
      'Klart — jag har gått igenom uppgifterna.',
    ];
    let call = 0;
    const executeTool = jest.fn(async () => ({ tasks: [] }));
    const accesses: any[] = [];
    const result = await runAgentTask({
      system: 'sys',
      goal: 'do it',
      deps: baseDeps({
        invokeModel: async () => script[call++],
        executeTool,
        onAccess: (a) => accesses.push(a),
      }),
    });
    expect(executeTool).toHaveBeenCalledWith('list_tasks', {});
    expect(result.stopped).toBe('done');
    expect(result.finalText).toContain('Klart');
    // list_tasks is a read → surfaced as an access for the transparent UI.
    expect(accesses).toEqual([{ kind: 'task', id: undefined, title: undefined, at: '2026-06-14T11:00:00.000Z' }]);
  });

  it('stops with "loop" when the same tool call repeats', async () => {
    const result = await runAgentTask({
      system: 's',
      goal: 'g',
      deps: baseDeps({ invokeModel: async () => '```json\n{"tool":"list_tasks","arguments":{}}\n```' }),
    });
    expect(result.stopped).toBe('loop');
  });

  it('honours maxSteps for a model that never stops calling distinct tools', async () => {
    let n = 0;
    const result = await runAgentTask({
      system: 's',
      goal: 'g',
      maxSteps: 3,
      deps: baseDeps({ invokeModel: async () => `\`\`\`json\n{"tool":"create_task","arguments":{"title":"t${n++}"}}\n\`\`\`` }),
    });
    expect(result.steps.length).toBe(3);
    expect(result.stopped).toBe('maxSteps');
  });

  it('records a tool error without aborting the loop', async () => {
    const script = ['```json\n{"tool":"create_task","arguments":{"title":"X"}}\n```', 'done'];
    let call = 0;
    const result = await runAgentTask({
      system: 's',
      goal: 'g',
      deps: baseDeps({
        invokeModel: async () => script[call++],
        executeTool: async () => { throw new Error('boom'); },
      }),
    });
    expect(result.toolCalls[0].error).toBe('boom');
    expect(result.stopped).toBe('done');
  });

  it('stops immediately when aborted', async () => {
    const result = await runAgentTask({
      system: 's',
      goal: 'g',
      deps: baseDeps({ isAborted: () => true }),
    });
    expect(result.stopped).toBe('aborted');
  });
});
