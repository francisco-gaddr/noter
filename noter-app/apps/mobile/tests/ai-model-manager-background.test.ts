const mockUnloadNative = jest.fn();
const mockAddEventListener = jest.fn();
const mockIsBackgroundEnabled = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: any[]) => mockAddEventListener(...args),
  },
}));

jest.mock('../utils/runtime', () => ({
  isExpoGo: () => false,
}));

jest.mock('react-native-fs', () => ({
  default: {
    exists: jest.fn().mockResolvedValue(true),
    DocumentDirectoryPath: '/docs',
  },
}));

jest.mock('../services/ai/native/MLCModule', () => ({
  loadModel: jest.fn(),
  chat: jest.fn(),
  unloadModel: (...args: any[]) => mockUnloadNative(...args),
}));

jest.mock('../services/ai/runtimeSettings', () => ({
  isAiBackgroundWorkEnabled: (...args: any[]) => mockIsBackgroundEnabled(...args),
}));

describe('ModelManager background behavior', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    jest.resetModules();
    mockUnloadNative.mockReset();
    mockAddEventListener.mockReset();
    mockIsBackgroundEnabled.mockReset();
  });

  it('unloads model when app backgrounds and background AI is disabled', async () => {
    mockIsBackgroundEnabled.mockResolvedValue(false);
    require('../services/ai/ModelManager');
    const callback = mockAddEventListener.mock.calls[0][1];
    callback('background');
    await flush();
    expect(mockUnloadNative).toHaveBeenCalledTimes(1);
  });

  it('keeps model loaded when app backgrounds and background AI is enabled', async () => {
    mockIsBackgroundEnabled.mockResolvedValue(true);
    require('../services/ai/ModelManager');
    const callback = mockAddEventListener.mock.calls[0][1];
    callback('background');
    await flush();
    expect(mockUnloadNative).toHaveBeenCalledTimes(0);
  });
});
