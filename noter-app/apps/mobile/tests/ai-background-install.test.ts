const mockResumePendingModelDownloads = jest.fn();
const mockRegisterTaskAsync = jest.fn();
const mockIsTaskRegisteredAsync = jest.fn();
const mockDefineTask = jest.fn();
const mockAppStateListenerRemove = jest.fn();
const mockAddEventListener = jest.fn();

jest.mock('../services/ai/modelService', () => ({
  resumePendingModelDownloads: (...args: any[]) => mockResumePendingModelDownloads(...args),
}));

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: {
    NewData: 'new-data',
    Failed: 'failed',
  },
  registerTaskAsync: (...args: any[]) => mockRegisterTaskAsync(...args),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: any[]) => mockDefineTask(...args),
  isTaskRegisteredAsync: (...args: any[]) => mockIsTaskRegisteredAsync(...args),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: any[]) => mockAddEventListener(...args),
  },
}));

describe('AI background install recovery', () => {
  beforeEach(() => {
    jest.resetModules();
    mockResumePendingModelDownloads.mockReset();
    mockRegisterTaskAsync.mockReset();
    mockIsTaskRegisteredAsync.mockReset();
    mockDefineTask.mockReset();
    mockAppStateListenerRemove.mockReset();
    mockAddEventListener.mockReset();
    mockResumePendingModelDownloads.mockResolvedValue(undefined);
    mockIsTaskRegisteredAsync.mockResolvedValue(false);
    mockRegisterTaskAsync.mockResolvedValue(undefined);
    mockAddEventListener.mockReturnValue({ remove: mockAppStateListenerRemove });
  });

  it('registers background recovery task and resumes pending installs on startup', async () => {
    const { initializeAiBackgroundInstallRecovery } = require('../services/ai/backgroundInstall');

    await initializeAiBackgroundInstallRecovery();

    expect(mockDefineTask).toHaveBeenCalledWith('ai-model-install-recovery', expect.any(Function));
    expect(mockRegisterTaskAsync).toHaveBeenCalledWith('ai-model-install-recovery', expect.objectContaining({
      stopOnTerminate: false,
      startOnBoot: true,
    }));
    expect(mockResumePendingModelDownloads).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('reuses the registered task and resumes again when the app becomes active', async () => {
    const { initializeAiBackgroundInstallRecovery, resetAiBackgroundInstallRecoveryForTests } = require('../services/ai/backgroundInstall');

    await initializeAiBackgroundInstallRecovery();
    const handler = mockAddEventListener.mock.calls[0][1];
    await handler('active');

    expect(mockResumePendingModelDownloads).toHaveBeenCalledTimes(2);

    resetAiBackgroundInstallRecoveryForTests();
    expect(mockAppStateListenerRemove).toHaveBeenCalled();
  });
});
