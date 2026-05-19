const { createUpdaterStateMachine, reduce, INITIAL_STATE } = require('../src/updaterStatus');

describe('reduce', () => {
  it('starts at idle', () => {
    expect(INITIAL_STATE.status).toBe('idle');
  });

  it('transitions to checking', () => {
    const s = reduce(INITIAL_STATE, { type: 'checking' });
    expect(s.status).toBe('checking');
    expect(s.error).toBeNull();
  });

  it('records the version on "available"', () => {
    const s = reduce(INITIAL_STATE, { type: 'available', data: { version: '1.2.3' } });
    expect(s.status).toBe('available');
    expect(s.version).toBe('1.2.3');
  });

  it('progress clamps percent to [0,100]', () => {
    const s = reduce(INITIAL_STATE, { type: 'progress', data: { percent: 250 } });
    expect(s.status).toBe('downloading');
    expect(s.progress.percent).toBe(100);
  });

  it('ignores progress after ready', () => {
    let s = reduce(INITIAL_STATE, { type: 'ready', data: { version: '2.0.0' } });
    const ready = s;
    s = reduce(s, { type: 'progress', data: { percent: 50 } });
    expect(s).toBe(ready);
  });

  it('ready sets percent to 100', () => {
    const s = reduce(INITIAL_STATE, { type: 'ready', data: { version: '2.0.0' } });
    expect(s.status).toBe('ready');
    expect(s.progress.percent).toBe(100);
  });

  it('error truncates long messages', () => {
    const s = reduce(INITIAL_STATE, { type: 'error', data: { message: 'x'.repeat(500) } });
    expect(s.status).toBe('error');
    expect(s.error.length).toBeLessThanOrEqual(201);
  });

  it('rejected captures reason', () => {
    const s = reduce(INITIAL_STATE, { type: 'rejected', data: { reason: 'sigstore-verify-failed' } });
    expect(s.status).toBe('rejected');
    expect(s.error).toBe('sigstore-verify-failed');
  });

  it('not-available does not regress past ready', () => {
    let s = reduce(INITIAL_STATE, { type: 'ready', data: { version: '2.0.0' } });
    s = reduce(s, { type: 'not-available' });
    expect(s.status).toBe('ready');
  });

  it('unknown event type is a no-op', () => {
    const s = reduce(INITIAL_STATE, { type: 'wat' });
    expect(s).toBe(INITIAL_STATE);
  });
});

describe('createUpdaterStateMachine', () => {
  it('aggregates a complete lifecycle', () => {
    const m = createUpdaterStateMachine();
    m.dispatch({ type: 'checking' });
    m.dispatch({ type: 'available', data: { version: '3.0.0' } });
    m.dispatch({ type: 'progress', data: { percent: 50 } });
    m.dispatch({ type: 'ready', data: { version: '3.0.0' } });
    const s = m.get();
    expect(s.status).toBe('ready');
    expect(s.version).toBe('3.0.0');
  });

  it('reset returns to INITIAL_STATE', () => {
    const m = createUpdaterStateMachine();
    m.dispatch({ type: 'error', data: { message: 'oops' } });
    m.reset();
    expect(m.get().status).toBe('idle');
  });
});
