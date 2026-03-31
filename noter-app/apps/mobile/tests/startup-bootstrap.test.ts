import { runStartupBootstrap } from '../services/startup';

const mockRecordStartupBootstrap = jest.fn();

jest.mock('../services/perfMetrics', () => ({
  recordStartupBootstrap: (...args: any[]) => mockRecordStartupBootstrap(...args),
}));

describe('runStartupBootstrap', () => {
  beforeEach(() => {
    mockRecordStartupBootstrap.mockClear();
  });

  it('returns ok when startup completes', async () => {
    const result = await runStartupBootstrap(
      async () => undefined
    );

    expect(result).toEqual({ ok: true });
    expect(mockRecordStartupBootstrap).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('captures startup errors without throwing', async () => {
    const onError = jest.fn();

    const result = await runStartupBootstrap(
      async () => {
        throw new Error('boom');
      },
      onError
    );

    expect(result).toEqual({ ok: false, message: 'boom' });
    expect(onError).toHaveBeenCalledWith('boom', expect.any(Error));
    expect(mockRecordStartupBootstrap).toHaveBeenCalledWith(false, expect.any(Number), 'boom');
  });
});
