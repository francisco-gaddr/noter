import { runStartupBootstrap } from '../services/startup';

describe('runStartupBootstrap', () => {
  it('returns ok when startup completes', async () => {
    const result = await runStartupBootstrap(
      async () => undefined
    );

    expect(result).toEqual({ ok: true });
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
  });
});
