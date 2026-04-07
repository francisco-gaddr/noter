describe('mlcBinary resolution', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete process.env.MLC_LLM_BIN;
    delete process.env.LOCALAPPDATA;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('prefers explicit MLC_LLM_BIN when available', async () => {
    process.env.MLC_LLM_BIN = 'C:\\mlc\\mlc_llm.exe';
    const spawnMock = jest.fn((command: string) => {
      const listeners: Record<string, Array<(value?: any) => void>> = {};
      const proc = {
        kill: jest.fn(),
        on: (event: string, handler: (value?: any) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
          return proc;
        },
      };
      process.nextTick(() => {
        (listeners.exit || []).forEach((handler) => handler(command === process.env.MLC_LLM_BIN ? 0 : 1));
      });
      return proc as any;
    });

    jest.doMock('child_process', () => ({ spawn: spawnMock }));

    const { resolveMlcCommand } = await import('../src/services/ai/mlcBinary');
    const resolved = await resolveMlcCommand();

    expect(resolved.command).toBe('C:\\mlc\\mlc_llm.exe');
    expect(resolved.prefixArgs).toEqual([]);
  });

  it('uses py module fallback on windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.LOCALAPPDATA = 'C:\\Users\\oscar\\AppData\\Local';
    const spawnMock = jest.fn((command: string, args: string[]) => {
      const listeners: Record<string, Array<(value?: any) => void>> = {};
      const proc = {
        kill: jest.fn(),
        on: (event: string, handler: (value?: any) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
          return proc;
        },
      };
      process.nextTick(() => {
        if (command === 'py' && args[0] === '-m' && args[1] === 'mlc_llm') {
          (listeners.exit || []).forEach((handler) => handler(0));
          return;
        }
        (listeners.error || []).forEach((handler) => handler(new Error('ENOENT')));
      });
      return proc as any;
    });

    jest.doMock('child_process', () => ({ spawn: spawnMock }));
    jest.doMock('fs/promises', () => ({
      __esModule: true,
      default: {
        readdir: jest.fn().mockImplementation(async (target: string) => {
          if (target.endsWith('Programs\\Python')) {
            return [{ name: 'Python311', isDirectory: () => true }];
          }
          return [];
        }),
        access: jest.fn().mockRejectedValue(new Error('missing')),
      },
      readdir: jest.fn().mockImplementation(async (target: string) => {
        if (target.endsWith('Programs\\Python')) {
          return [{ name: 'Python311', isDirectory: () => true }];
        }
        return [];
      }),
      access: jest.fn().mockRejectedValue(new Error('missing')),
    }));

    const { resolveMlcCommand } = await import('../src/services/ai/mlcBinary');
    const resolved = await resolveMlcCommand();

    expect(resolved.command).toBe('py');
    expect(resolved.prefixArgs).toEqual(['-m', 'mlc_llm']);
    expect(spawnMock).toHaveBeenCalledWith(
      'py',
      ['-m', 'mlc_llm', '--help'],
      expect.objectContaining({
        env: expect.objectContaining({
          Path: expect.stringContaining('Python311\\Lib\\site-packages\\tvm'),
        }),
      })
    );
  });
});
