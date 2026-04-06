describe('AI native runtime', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('treats direct native module exports as valid in EAS builds', () => {
    jest.doMock('../utils/runtime', () => ({
      isExpoGo: () => false,
    }));
    jest.doMock('react-native', () => ({
      NativeModules: {
        MLCModule: {
          loadModel: jest.fn(),
          generate: jest.fn(),
        },
      },
    }));
    jest.doMock('react-native-fs', () => ({
      DocumentDirectoryPath: '/docs',
      exists: jest.fn(),
      mkdir: jest.fn(),
    }));
    jest.doMock('react-native-zip-archive', () => ({
      unzip: jest.fn(),
    }));

    const { getLocalAiRuntimeStatus, getModelInstallBlocker } = require('../services/ai/nativeRuntime');

    expect(getLocalAiRuntimeStatus()).toMatchObject({
      expoGo: false,
      fileSystemAvailable: true,
      zipAvailable: true,
      mlcModuleAvailable: true,
    });
    expect(getModelInstallBlocker()).toBeNull();
  });

  it('returns Expo Go blocker when running in Expo Go', () => {
    jest.doMock('../utils/runtime', () => ({
      isExpoGo: () => true,
    }));
    jest.doMock('react-native', () => ({
      NativeModules: {},
    }));
    jest.doMock('react-native-fs', () => ({
      DocumentDirectoryPath: '/docs',
    }));
    jest.doMock('react-native-zip-archive', () => ({
      unzip: jest.fn(),
    }));

    const { getModelInstallBlocker } = require('../services/ai/nativeRuntime');

    expect(getModelInstallBlocker()).toContain('Expo Go');
  });

  it('returns blocker when MLC runtime is missing in native build', () => {
    jest.doMock('../utils/runtime', () => ({
      isExpoGo: () => false,
    }));
    jest.doMock('react-native', () => ({
      NativeModules: {},
    }));
    jest.doMock('react-native-fs', () => ({
      DocumentDirectoryPath: '/docs',
    }));
    jest.doMock('react-native-zip-archive', () => ({
      unzip: jest.fn(),
    }));

    const { getModelInstallBlocker } = require('../services/ai/nativeRuntime');

    expect(getModelInstallBlocker()).toContain('MLC-runtime');
  });
});
