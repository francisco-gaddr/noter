/**
 * On-device inference is provided by a native MLC engine. When that engine isn't
 * linked into the build (the default placeholder bridge), the chat path must FAIL
 * HONESTLY rather than resolve the bridge's canned string as if it were a model reply.
 * These tests pin that contract without needing a device.
 */
const loadWith = (mlcModule: any) => {
  jest.resetModules();
  jest.doMock('react-native', () => ({ NativeModules: mlcModule ? { MLCModule: mlcModule } : {} }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./MLCModule');
};

afterEach(() => { jest.dontMock('react-native'); jest.resetModules(); });

describe('isLocalInferenceAvailable', () => {
  it('is false when the native module is absent', async () => {
    const m = loadWith(null);
    expect(await m.isLocalInferenceAvailable()).toBe(false);
  });

  it('is false for the placeholder bridge (generate present, no real engine)', async () => {
    const m = loadWith({ generate: jest.fn() }); // no getLocalConversionCapabilities → engine unavailable
    expect(await m.isLocalInferenceAvailable()).toBe(false);
  });

  it('is true when the native engine reports engineAvailable', async () => {
    const m = loadWith({
      generate: jest.fn(async () => 'hello from the model'),
      getLocalConversionCapabilities: jest.fn(async () => ({ engineAvailable: true, converterAvailable: true })),
    });
    expect(await m.isLocalInferenceAvailable()).toBe(true);
  });
});

describe('chat (honest gate)', () => {
  it('rejects with "not linked" when no native module', async () => {
    const m = loadWith(null);
    await expect(m.chat('hi')).rejects.toThrow('MLCModule not linked');
  });

  it('rejects with the Hermes guidance for the placeholder bridge (never returns a fake reply)', async () => {
    const generate = jest.fn(async () => 'PLACEHOLDER not implemented');
    const m = loadWith({ generate });
    await expect(m.chat('hi')).rejects.toThrow(/på-enheten-inferens är inte tillgänglig/i);
    expect(generate).not.toHaveBeenCalled(); // the fake reply path is never reached
  });

  it('runs the real engine when available', async () => {
    const generate = jest.fn(async () => 'real reply');
    const m = loadWith({
      generate,
      getLocalConversionCapabilities: jest.fn(async () => ({ engineAvailable: true, converterAvailable: true })),
    });
    await expect(m.chat('hi')).resolves.toBe('real reply');
    expect(generate).toHaveBeenCalledWith('hi');
  });
});
