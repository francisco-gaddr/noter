import { installGracefulShutdown, isShuttingDown } from '../../src/utils/gracefulShutdown';
import { EventEmitter } from 'node:events';

// Stop process.exit from actually exiting; just record the code.
let lastExitCode: number | undefined;
const exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  lastExitCode = code;
  return undefined as never;
}) as never);

// We have to stub mongoose.connection.close to avoid touching the network.
jest.mock('mongoose', () => ({
  __esModule: true,
  default: {
    connection: { close: jest.fn().mockResolvedValue(undefined), readyState: 0 },
  },
}));

const makeHttpServer = (closeBehaviour: 'ok' | 'error' | 'hang' = 'ok') => {
  const ee = new EventEmitter() as EventEmitter & { close: (cb: (err?: Error) => void) => void };
  ee.close = (cb) => {
    if (closeBehaviour === 'hang') return; // never call cb
    if (closeBehaviour === 'error') return cb(new Error('cannot close'));
    return cb();
  };
  return ee as any;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('installGracefulShutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module-internal shutdown flag by re-requiring (since module state
    // is per-load and we've already loaded it once at the top).
  });

  afterAll(() => {
    exitMock.mockRestore();
  });

  it('exposes isShuttingDown=false before any signal', () => {
    expect(isShuttingDown()).toBe(false);
  });

  it('runs the supplied extras in declared order on SIGTERM', async () => {
    const calls: string[] = [];
    installGracefulShutdown({
      httpServer: makeHttpServer('ok'),
      extras: [
        { name: 'first', close: async () => { calls.push('first'); } },
        { name: 'second', close: async () => { calls.push('second'); } },
      ],
    });

    process.emit('SIGTERM' as any);
    // Let the async pipeline run.
    await sleep(80);

    expect(calls).toEqual(['first', 'second']);
    expect(isShuttingDown()).toBe(true);
    expect(lastExitCode).toBe(0);
  });
});
