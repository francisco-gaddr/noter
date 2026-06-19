import { createDebounced } from './debounce';

describe('createDebounced', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('invokes once on the trailing edge after a burst of calls', () => {
    let calls = 0;
    const d = createDebounced(() => { calls += 1; }, 1000);
    d(); d(); d();
    expect(calls).toBe(0); // nothing yet
    jest.advanceTimersByTime(999);
    expect(calls).toBe(0);
    jest.advanceTimersByTime(2);
    expect(calls).toBe(1); // a single coalesced call
  });

  it('passes the LATEST arguments through', () => {
    const seen: number[] = [];
    const d = createDebounced((n: number) => { seen.push(n); }, 500);
    d(1); d(2); d(3);
    jest.advanceTimersByTime(500);
    expect(seen).toEqual([3]);
  });

  it('cancel() prevents a pending invocation', () => {
    let calls = 0;
    const d = createDebounced(() => { calls += 1; }, 500);
    d();
    d.cancel();
    jest.advanceTimersByTime(1000);
    expect(calls).toBe(0);
  });

  it('can fire again after a previous invocation settled', () => {
    let calls = 0;
    const d = createDebounced(() => { calls += 1; }, 100);
    d();
    jest.advanceTimersByTime(100);
    d();
    jest.advanceTimersByTime(100);
    expect(calls).toBe(2);
  });
});
