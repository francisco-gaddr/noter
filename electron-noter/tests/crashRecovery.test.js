const { createRecoveryPolicy } = require('../src/crashRecovery');

describe('crashRecovery policy', () => {
  it('first crash → reload', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now });
    expect(policy.recordCrash('oom')).toEqual({ action: 'reload', attempt: 1 });
  });

  it('clean-exit and killed are ignored (not counted)', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now });
    expect(policy.recordCrash('clean-exit').action).toBe('ignore');
    expect(policy.recordCrash('killed').action).toBe('ignore');
    expect(policy.state().recentCount).toBe(0);
  });

  it('crashes accumulate within the window', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now, maxCrashes: 3, windowMs: 5000 });
    expect(policy.recordCrash('oom').action).toBe('reload');
    now += 100;
    expect(policy.recordCrash('oom').action).toBe('reload');
    now += 100;
    expect(policy.recordCrash('oom').action).toBe('reload');
    now += 100;
    // 4th crash within window → prompt
    expect(policy.recordCrash('oom').action).toBe('prompt');
  });

  it('crashes outside the window are forgotten', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now, maxCrashes: 2, windowMs: 1000 });
    policy.recordCrash('oom');
    policy.recordCrash('oom');
    expect(policy.recordCrash('oom').action).toBe('prompt');
    // Advance past the window
    now += 5000;
    // Old crashes drop off; this is a fresh series
    expect(policy.recordCrash('oom').action).toBe('reload');
  });

  it('reset clears the counter', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now, maxCrashes: 1 });
    policy.recordCrash('oom');
    policy.recordCrash('oom');
    expect(policy.state().recentCount).toBe(2);
    policy.reset();
    expect(policy.state().recentCount).toBe(0);
  });

  it('reports recentCount via state()', () => {
    let now = 1_000_000;
    const policy = createRecoveryPolicy({ now: () => now });
    policy.recordCrash('oom');
    policy.recordCrash('oom');
    expect(policy.state().recentCount).toBe(2);
  });
});
