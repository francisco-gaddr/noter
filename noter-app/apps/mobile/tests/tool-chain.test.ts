import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '../services/ai/toolChain';

describe('tool chain guards', () => {
  it('stops when the same iteration signature repeats', () => {
    const calls = [{ tool: 'list_tasks', arguments: { parentNoteId: 'abc' } }];
    const keys = toToolCallKeys(calls);
    const signature = toToolIterationSignature('clean', 'raw', keys);
    const signatures = new Set<string>();
    const executed = new Set<string>();

    const firstStop = shouldStopToolIteration(signature, keys, signatures, executed);
    const secondStop = shouldStopToolIteration(signature, keys, signatures, executed);

    expect(firstStop).toBe(false);
    expect(secondStop).toBe(true);
  });

  it('stops when no new tool calls are introduced', () => {
    const calls = [{ tool: 'get_note', arguments: { id: 'n1' } }];
    const keys = toToolCallKeys(calls);
    const signatures = new Set<string>();
    const executed = new Set<string>(keys);

    const shouldStop = shouldStopToolIteration('sig-2', keys, signatures, executed);
    expect(shouldStop).toBe(true);
  });
});
