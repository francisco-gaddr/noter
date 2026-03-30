const { EventEmitter } = require('events');

describe('mlc command resolution', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete process.env.MLC_LLM_BIN;
  });

  it('prefers explicit MLC_LLM_BIN when available', async () => {
    process.env.MLC_LLM_BIN = 'C:\\mlc\\mlc_llm.exe';
    const spawnMock = jest.fn((command) => {
      const proc = new EventEmitter();
      proc.kill = jest.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => proc.emit('exit', command === process.env.MLC_LLM_BIN ? 0 : 1));
      return proc;
    });
    jest.doMock('child_process', () => ({ spawn: spawnMock }));

    const { resolveMlcCommand } = require('../src/mlc');
    const resolved = await resolveMlcCommand();

    expect(resolved.command).toBe('C:\\mlc\\mlc_llm.exe');
    expect(resolved.prefixArgs).toEqual([]);
  });

  it('falls back to py module execution when direct mlc_llm is unavailable', async () => {
    const spawnMock = jest.fn((command, args) => {
      const proc = new EventEmitter();
      proc.kill = jest.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => {
        if (command === 'py' && args[0] === '-m' && args[1] === 'mlc_llm') {
          proc.emit('exit', 0);
          return;
        }
        proc.emit('error', new Error('ENOENT'));
      });
      return proc;
    });
    jest.doMock('child_process', () => ({ spawn: spawnMock }));

    const { resolveMlcCommand } = require('../src/mlc');
    const resolved = await resolveMlcCommand();

    expect(resolved.command).toBe('py');
    expect(resolved.prefixArgs).toEqual(['-m', 'mlc_llm']);
  });
});
