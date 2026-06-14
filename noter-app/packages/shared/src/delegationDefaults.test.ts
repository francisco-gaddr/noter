import {
  extractDelegationDefaults,
  applyDelegationDefaults,
  parseDelegationDefaults,
} from './delegationDefaults';
import type { AiTaskDelegation } from './agentTasks';

const del = (o: Partial<AiTaskDelegation>): AiTaskDelegation => ({ assignee: 'ai', ...o });

describe('extractDelegationDefaults', () => {
  it('keeps reusable choices and drops per-task runtime state', () => {
    const d = del({
      source: 'hermes', provider: 'preset-hermes-pi-ollama', model: 'qwen2.5:3b-instruct',
      contextLevel: 'standard', role: '  Planerare  ', runOnBackend: true,
      budget: { maxStepsPerRun: 6, maxTokens: 4000, maxRuns: 0 },
      notify: { onStart: true },
      instructions: 'task-specific', status: 'done', result: 'x', runCount: 5, lastRunAt: 'yesterday',
    });
    const defaults = extractDelegationDefaults(d)!;
    expect(defaults).toMatchObject({ source: 'hermes', model: 'qwen2.5:3b-instruct', role: 'Planerare', runOnBackend: true });
    expect(defaults.budget).toEqual({ maxStepsPerRun: 6, maxTokens: 4000 }); // 0 maxRuns dropped
    expect(defaults.notify).toEqual({ onStart: true, onFinish: true });
    expect(defaults).not.toHaveProperty('instructions');
    expect(defaults).not.toHaveProperty('status');
    expect(defaults).not.toHaveProperty('runCount');
  });

  it('returns null for a user (non-AI) task', () => {
    expect(extractDelegationDefaults({ assignee: 'user' })).toBeNull();
    expect(extractDelegationDefaults(null)).toBeNull();
  });
});

describe('applyDelegationDefaults', () => {
  it('builds a fresh AI delegation pre-filled from defaults with clean state', () => {
    const d = applyDelegationDefaults({ source: 'hermes', model: 'm', runOnBackend: true, budget: { maxTokens: 2000 } });
    expect(d.assignee).toBe('ai');
    expect(d.source).toBe('hermes');
    expect(d.runOnBackend).toBe(true);
    expect(d.budget).toEqual({ maxTokens: 2000 });
    expect(d.status).toBe('idle');
    expect(d.runCount).toBe(0);
  });

  it('falls back to a sensible cold default when no defaults saved', () => {
    const d = applyDelegationDefaults(null);
    expect(d).toMatchObject({ assignee: 'ai', source: 'api', localOnly: false, toolUse: true, runOnBackend: false });
  });

  it('round-trips through extract → apply (last choice becomes next default)', () => {
    const configured = del({ source: 'hermes', model: 'm', contextLevel: 'deep', toolUse: false, budget: { maxCredits: 3 } });
    const next = applyDelegationDefaults(extractDelegationDefaults(configured));
    expect(next).toMatchObject({ source: 'hermes', model: 'm', contextLevel: 'deep', toolUse: false });
    expect(next.budget).toEqual({ maxCredits: 3 });
  });
});

describe('parseDelegationDefaults', () => {
  it('parses a JSON string and validates fields', () => {
    const parsed = parseDelegationDefaults(JSON.stringify({ source: 'hermes', contextLevel: 'fast', budget: { maxTokens: 1000 } }));
    expect(parsed).toMatchObject({ source: 'hermes', contextLevel: 'fast' });
    expect(parsed!.budget).toEqual({ maxTokens: 1000 });
  });

  it('returns null for invalid / empty input', () => {
    expect(parseDelegationDefaults('')).toBeNull();
    expect(parseDelegationDefaults('not json')).toBeNull();
    expect(parseDelegationDefaults(null)).toBeNull();
    expect(parseDelegationDefaults([1, 2])).toBeNull();
  });

  it('rejects an invalid contextLevel/source but keeps the rest', () => {
    const parsed = parseDelegationDefaults({ source: 'bogus', contextLevel: 'nope', model: 'm' });
    expect(parsed).toMatchObject({ model: 'm' });
    expect(parsed!.source).toBeUndefined();
    expect(parsed!.contextLevel).toBeUndefined();
  });
});
