import { EventEmitter } from 'node:events';
import {
  planChangeStreamRestart,
  installSingleStream,
  isChangeStreamDegraded,
  stopChangeStreamInvalidator,
  changeStreamCount,
} from '../../src/services/changeStreamInvalidator';

const RESTART_MAX_ATTEMPTS = 10; // mirrors the module constant

const makeStream = () => {
  const s = new EventEmitter() as any;
  s.close = () => {};
  return s;
};

describe('planChangeStreamRestart', () => {
  it('backs off exponentially then caps the delay', () => {
    expect(planChangeStreamRestart(0)).toEqual({ giveUp: false, delayMs: 1000 });
    expect(planChangeStreamRestart(1).delayMs).toBe(2000);
    expect(planChangeStreamRestart(2).delayMs).toBe(4000);
    expect(planChangeStreamRestart(5).delayMs).toBe(30000); // 32000 capped to 30000
    expect(planChangeStreamRestart(9)).toEqual({ giveUp: false, delayMs: 30000 });
  });

  it('gives up once the attempt cap is reached', () => {
    expect(planChangeStreamRestart(RESTART_MAX_ATTEMPTS).giveUp).toBe(true);
    expect(planChangeStreamRestart(RESTART_MAX_ATTEMPTS + 5).giveUp).toBe(true);
  });
});

describe('change-stream restart loop (stability)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    await stopChangeStreamInvalidator(); // resets degraded + clears the tracked streams
  });

  it('stops restarting after the cap (no infinite loop) and never leaks dead streams', () => {
    let watchCalls = 0;
    let current: any;
    const model = {
      collection: { collectionName: 'notes' },
      watch: () => { watchCalls += 1; current = makeStream(); return current; },
    };
    const io = { to: () => ({ emit: () => {} }) } as any;
    const reg = { model: model as any, resourceLabel: 'note' as const };

    installSingleStream(io, reg); // initial attempt
    expect(watchCalls).toBe(1);
    expect(changeStreamCount()).toBe(1);

    // Drive a permanent fault: every restart errors again. Advance past any backoff each time.
    for (let i = 0; i < RESTART_MAX_ATTEMPTS + 3; i += 1) {
      current.emit('error', new Error('not a replica set'));
      jest.advanceTimersByTime(30_000);
    }

    expect(isChangeStreamDegraded()).toBe(true);
    // Exactly RESTART_MAX_ATTEMPTS installs happened (1 initial + restarts), then it gave up.
    expect(watchCalls).toBe(RESTART_MAX_ATTEMPTS);
    // The dead stream was removed from the tracked list — the array did not grow per restart.
    expect(changeStreamCount()).toBe(0);
  });

  it('a healthy stream is tracked and removed on close (no leak across stop)', async () => {
    const model = { collection: { collectionName: 'tasks' }, watch: () => makeStream() };
    const io = { to: () => ({ emit: () => {} }) } as any;
    installSingleStream(io, { model: model as any, resourceLabel: 'task' });
    expect(changeStreamCount()).toBe(1);
    await stopChangeStreamInvalidator();
    expect(changeStreamCount()).toBe(0);
    expect(isChangeStreamDegraded()).toBe(false);
  });
});
