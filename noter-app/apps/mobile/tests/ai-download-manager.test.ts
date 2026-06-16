// Verifies the resumable download manager's control surface: a started download shows
// up as active, pause flips it to 'paused', and the observer/getActiveDownloads APIs
// reflect state. The native transfer is mocked with a controllable promise so the
// managed loop stays in flight while we exercise pause.

jest.mock('../services/ai/keepAwake', () => ({ acquireKeepAwake: () => () => {} }));

let resolveDownload: (v: any) => void;
const mockDownloadAsync = jest.fn();
const mockPauseAsync = jest.fn().mockResolvedValue(undefined);
const mockResumeAsync = jest.fn();
const mockCancelAsync = jest.fn().mockResolvedValue(undefined);
const mockSavable = jest.fn((..._a: any[]) => ({ url: 'u', fileUri: 'f', options: {}, resumeData: 'rd' }));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: (...a: any[]) => mockDownloadAsync(...a),
    pauseAsync: (...a: any[]) => mockPauseAsync(...a),
    resumeAsync: (...a: any[]) => mockResumeAsync(...a),
    cancelAsync: (...a: any[]) => mockCancelAsync(...a),
    savable: (...a: any[]) => mockSavable(...a),
  })),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

import {
  downloadGgufModel,
  pauseModelDownload,
  resumeModelDownload,
  stopModelDownload,
  getActiveDownloads,
} from '../services/ai/ModelDownloader';

describe('ModelDownloader manager (pause/resume/cancel/list)', () => {
  beforeEach(() => {
    mockDownloadAsync.mockReset();
    mockDownloadAsync.mockReturnValue(new Promise((res) => { resolveDownload = res; }));
  });

  it('lists an in-flight download and pauses/resumes/cancels it', async () => {
    const p = downloadGgufModel('https://hf.test/m.gguf', 'user/model', 'Q4_K_M', undefined, { name: 'Test', totalBytes: 1000 });
    p.catch(() => {}); // we cancel it below; swallow the rejection
    await flush();

    let active = getActiveDownloads();
    expect(active.some((d) => d.modelId === 'user/model')).toBe(true);

    expect(await pauseModelDownload('user/model')).toBe(true);
    expect(mockPauseAsync).toHaveBeenCalled();
    expect(getActiveDownloads().find((d) => d.modelId === 'user/model')?.stage).toBe('paused');

    expect(await resumeModelDownload('user/model')).toBe(true);
    expect(getActiveDownloads().find((d) => d.modelId === 'user/model')?.stage).toBe('downloading');

    expect(await stopModelDownload('user/model')).toBe(true);
    expect(mockCancelAsync).toHaveBeenCalled();
    // Cancelled downloads drop out of the active list.
    expect(getActiveDownloads().some((d) => d.modelId === 'user/model')).toBe(false);

    // Let the loop unwind (the awaited downloadAsync resolves to undefined → cancelled).
    resolveDownload?.(undefined);
    await flush();
  });
});
