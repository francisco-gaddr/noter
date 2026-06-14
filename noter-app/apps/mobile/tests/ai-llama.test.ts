const mockCompletion = jest.fn();
const mockStopCompletion = jest.fn(async (..._args: any[]) => undefined);
const mockInitLlama = jest.fn();
const mockReleaseAll = jest.fn(async (..._args: any[]) => undefined);

jest.mock('llama.rn', () => ({
  initLlama: (...args: any[]) => mockInitLlama(...args),
  releaseAllLlama: (...args: any[]) => mockReleaseAll(...args),
}), { virtual: true });

import {
  loadLlamaModel,
  completeLlama,
  unloadLlamaModel,
  isLlamaLoaded,
  loadedModelPath,
} from '../services/ai/llama';

describe('llama.rn wrapper', () => {
  beforeEach(async () => {
    mockCompletion.mockReset();
    mockStopCompletion.mockClear();
    mockReleaseAll.mockClear();
    mockInitLlama.mockReset();
    mockInitLlama.mockResolvedValue({
      completion: (...args: any[]) => mockCompletion(...args),
      stopCompletion: mockStopCompletion,
    });
    await unloadLlamaModel();
  });

  it('loads a GGUF as a file:// URI and tracks the resident path', async () => {
    await loadLlamaModel('/docs/llama_models/m-Q4_K_M.gguf');
    expect(isLlamaLoaded()).toBe(true);
    expect(loadedModelPath()).toBe('/docs/llama_models/m-Q4_K_M.gguf');
    const params = mockInitLlama.mock.calls[0][0];
    expect(params.model).toBe('file:///docs/llama_models/m-Q4_K_M.gguf');
  });

  it('streams tokens via onToken and returns the full text', async () => {
    mockCompletion.mockImplementation(async (_params: any, cb: any) => {
      cb({ token: 'Hej' });
      cb({ token: ' där' });
      return { text: 'Hej där' };
    });
    await loadLlamaModel('/docs/m.gguf');
    const tokens: string[] = [];
    const text = await completeLlama(
      [{ id: '1', role: 'user', content: 'hej', createdAt: '' } as any],
      { onToken: (t) => tokens.push(t) }
    );
    expect(text).toBe('Hej där');
    expect(tokens.join('')).toBe('Hej där');
  });

  it('stops native completion when shouldStop() flips true', async () => {
    mockCompletion.mockImplementation(async (_params: any, cb: any) => {
      cb({ token: 'a' });
      return { text: 'a' };
    });
    await loadLlamaModel('/docs/m.gguf');
    await completeLlama([{ id: '1', role: 'user', content: 'x', createdAt: '' } as any], {
      shouldStop: () => true,
    });
    expect(mockStopCompletion).toHaveBeenCalled();
  });

  it('throws a clear error when completing with no model loaded', async () => {
    await unloadLlamaModel();
    await expect(
      completeLlama([{ id: '1', role: 'user', content: 'x', createdAt: '' } as any])
    ).rejects.toThrow('Ingen lokal modell');
  });
});
