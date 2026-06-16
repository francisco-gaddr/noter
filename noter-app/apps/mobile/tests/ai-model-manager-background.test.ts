const mockUnloadLlama = jest.fn();
const mockAddEventListener = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: any[]) => mockAddEventListener(...args),
  },
}));

// ModelManager reads model files through ModelDownloader (expo-file-system).
jest.mock('../services/ai/ModelDownloader', () => ({
  modelFileExists: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/ai/llama', () => ({
  loadLlamaModel: jest.fn(),
  completeLlama: jest.fn(),
  unloadLlamaModel: (...args: any[]) => mockUnloadLlama(...args),
  isLlamaLinked: jest.fn(() => true),
  isLlamaLoaded: jest.fn(() => false),
  loadedModelPath: jest.fn(() => null),
}));

describe('ModelManager background behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    mockUnloadLlama.mockReset();
    mockAddEventListener.mockReset();
  });

  it('keeps the model resident — never auto-unloads on background', () => {
    require('../services/ai/ModelManager');
    // The model must stay loaded once loaded, so ModelManager registers NO AppState
    // 'change' listener that could unload it when the app is backgrounded.
    const changeListeners = mockAddEventListener.mock.calls.filter((c) => c[0] === 'change');
    expect(changeListeners.length).toBe(0);
    expect(mockUnloadLlama).not.toHaveBeenCalled();
  });
});
