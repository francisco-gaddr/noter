import { StreamSink, createStreamSink } from './streamSink';

/**
 * Deterministic tests using an INJECTED clock + timer queue (no real time). This lets us prove the
 * exact throttle behaviour that fixes the mobile crash: many tokens must collapse into few UI flushes.
 */
class FakeClock {
  t = 0;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];
  private nextId = 1;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  clearTimer = (h: unknown): void => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  /** Advance time, firing any timers whose deadline is reached (in order). */
  advance(ms: number): void {
    const target = this.t + ms;
    // Fire due timers, allowing timers scheduled during firing to run if still due.
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at);
      if (due.length === 0) break;
      const next = due[0];
      this.timers = this.timers.filter((x) => x.id !== next.id);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}

const makeSink = (clock: FakeClock, extra?: Partial<Parameters<typeof createStreamSink>[0]>) => {
  const texts: string[] = [];
  const persists: string[] = [];
  const sink = new StreamSink({
    onText: (t) => texts.push(t),
    onPersist: (t) => persists.push(t),
    intervalMs: 60,
    persistIntervalMs: 1200,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...extra,
  });
  return { sink, texts, persists };
};

describe('StreamSink throttling', () => {
  it('flushes the FIRST token immediately (leading edge) so the user sees output start', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock);
    sink.push('Hello');
    expect(texts).toEqual(['Hello']);
  });

  it('collapses a burst of tokens within one interval into a SINGLE trailing flush', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock);
    sink.push('a'); // leading flush at t=0
    // 50 tokens all within the 60ms window — must NOT produce 50 flushes.
    for (let i = 0; i < 50; i += 1) {
      clock.advance(1); // 1ms between tokens
      sink.push('x');
    }
    // Only the leading flush has happened so far; the trailing one is scheduled.
    expect(texts.length).toBe(1);
    clock.advance(60); // let the trailing flush fire
    expect(texts.length).toBe(2); // leading + one trailing — NOT 51
    expect(sink.text).toBe('a' + 'x'.repeat(50));
    expect(texts[1]).toBe(sink.text);
  });

  it('across a long stream, flush count is bounded by elapsed/interval — not token count', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock, { intervalMs: 60 });
    // 600 tokens, 1ms apart = 600ms of streaming. At 60ms interval → ~10 flushes, not 600.
    sink.push('start');
    for (let i = 0; i < 600; i += 1) {
      clock.advance(1);
      sink.push('t');
    }
    sink.end();
    // Leading + trailing-per-window + final. Comfortably under 20, nowhere near 600.
    expect(texts.length).toBeLessThan(20);
    expect(texts[texts.length - 1]).toBe(sink.text); // last flush has the complete text
  });

  it('end() always delivers the complete text even if the last tokens were mid-window', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock);
    sink.push('one'); // leading
    clock.advance(5);
    sink.push('-two'); // buffered, trailing scheduled
    sink.end(); // must flush the buffered remainder
    expect(texts[texts.length - 1]).toBe('one-two');
  });

  it('persist is throttled on its own coarser cadence and force-flushes on end()', () => {
    const clock = new FakeClock();
    const { sink, persists } = makeSink(clock);
    sink.push('a'); // t=0 → first persist
    clock.advance(100);
    sink.push('b'); // <1200ms → no persist
    clock.advance(100);
    sink.push('c'); // still <1200ms → no persist
    expect(persists.length).toBe(1);
    sink.end(); // force persist of the final text
    expect(persists[persists.length - 1]).toBe('abc');
  });

  it('cancel() stops timers and does NOT deliver a final flush', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock);
    sink.push('a'); // leading flush
    clock.advance(5);
    sink.push('b'); // buffered
    const before = texts.length;
    sink.cancel();
    clock.advance(1000); // any pending timer must not fire
    expect(texts.length).toBe(before); // no extra flush after cancel
  });

  it('ignores empty/non-string deltas and never throws on a bad onText callback', () => {
    const clock = new FakeClock();
    const sink = new StreamSink({
      onText: () => { throw new Error('boom'); }, // a broken UI callback must not break streaming
      intervalMs: 0,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    expect(() => sink.push('')).not.toThrow();
    expect(() => sink.push('x')).not.toThrow(); // onText throws internally but is swallowed
    expect(sink.text).toBe('x');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => sink.push(123 as any)).not.toThrow();
  });

  it('push after end() is a no-op (a late token from an aborted stream cannot mutate state)', () => {
    const clock = new FakeClock();
    const { sink, texts } = makeSink(clock);
    sink.push('a');
    sink.end();
    const count = texts.length;
    sink.push('late');
    expect(sink.text).toBe('a');
    expect(texts.length).toBe(count);
  });
});
