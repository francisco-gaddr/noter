const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: any[]) => mockGetItem(...args),
  setItem: (...args: any[]) => mockSetItem(...args),
}));

import {
  isAiBackgroundWorkEnabled,
  resetAiRuntimeSettingsCache,
  setAiBackgroundWorkEnabled,
} from '../services/ai/runtimeSettings';

describe('AI runtime settings', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    resetAiRuntimeSettingsCache();
  });

  it('loads disabled state by default', async () => {
    mockGetItem.mockResolvedValue(null);
    const enabled = await isAiBackgroundWorkEnabled();
    expect(enabled).toBe(false);
  });

  it('persists enabled state', async () => {
    await setAiBackgroundWorkEnabled(true);
    expect(mockSetItem).toHaveBeenCalledWith('ai_background_work_enabled_global', 'true');
  });

  it('reads persisted enabled state', async () => {
    mockGetItem.mockResolvedValue('true');
    const enabled = await isAiBackgroundWorkEnabled();
    expect(enabled).toBe(true);
  });
});
