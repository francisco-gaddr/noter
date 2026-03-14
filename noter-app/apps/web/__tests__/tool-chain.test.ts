import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '../services/ai/toolChain';

describe('web tool chain guards', () => {
  it('stops repeated signatures', () => {
    const calls = [{ tool: 'list_projects', arguments: {} }];
    const keys = toToolCallKeys(calls);
    const signature = toToolIterationSignature('clean', 'raw', keys);
    const signatures = new Set<string>();
    const executed = new Set<string>();

    expect(shouldStopToolIteration(signature, keys, signatures, executed)).toBe(false);
    expect(shouldStopToolIteration(signature, keys, signatures, executed)).toBe(true);
  });

  it('accepts new calls and stores them', () => {
    const calls = [{ tool: 'get_task', arguments: { id: 't1' } }];
    const keys = toToolCallKeys(calls);
    const signatures = new Set<string>();
    const executed = new Set<string>();

    expect(shouldStopToolIteration('sig-new', keys, signatures, executed)).toBe(false);
    expect(executed.has(keys[0])).toBe(true);
  });
});
