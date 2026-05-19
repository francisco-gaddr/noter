import { register, enqueue, drain, _size, _inFlight, _resetForTests } from '../../src/services/jobQueue';

beforeEach(() => _resetForTests());

describe('jobQueue', () => {
  it('runs an enqueued job and drains to empty', async () => {
    let saw: unknown = null;
    register<{ value: number }>('test-1', async (payload) => { saw = payload; });
    enqueue('test-1', { value: 42 });
    await drain();
    expect(saw).toEqual({ value: 42 });
    expect(_size()).toBe(0);
    expect(_inFlight()).toBe(0);
  });

  it('rejects unregistered job name', () => {
    expect(() => enqueue('nope', {})).toThrow(/no handler/);
  });

  it('rejects invalid job names', () => {
    expect(() => register('-bad-name', async () => undefined)).toThrow(/match/);
    expect(() => register('a'.repeat(100), async () => undefined)).toThrow(/match/);
    expect(() => register('', async () => undefined)).toThrow(/match/);
  });

  it('retries on handler failure up to maxAttempts', async () => {
    let attempts = 0;
    register('flaky', async () => {
      attempts++;
      if (attempts < 3) throw new Error('flaky');
    });
    enqueue('flaky', {}, { maxAttempts: 5 });
    await drain();
    expect(attempts).toBe(3);
  });

  it('drops job after maxAttempts exhausted', async () => {
    let attempts = 0;
    register('always-fails', async () => { attempts++; throw new Error('boom'); });
    enqueue('always-fails', {}, { maxAttempts: 2 });
    await drain();
    expect(attempts).toBe(2);
  });

  it('processes multiple jobs in order (FIFO)', async () => {
    const seen: number[] = [];
    register<{ n: number }>('orderly', async (p) => { seen.push(p.n); });
    enqueue('orderly', { n: 1 });
    enqueue('orderly', { n: 2 });
    enqueue('orderly', { n: 3 });
    await drain();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('respects delayMs (job does not run before its time)', async () => {
    let ran = false;
    register('delayed', async () => { ran = true; });
    enqueue('delayed', {}, { delayMs: 100 });
    // Don't await drain yet — give the queue a brief moment.
    await new Promise((r) => setTimeout(r, 20));
    expect(ran).toBe(false);
    await drain();
    expect(ran).toBe(true);
  });

  it('drain resolves immediately when queue is empty', async () => {
    await expect(drain()).resolves.toBeUndefined();
  });
});
