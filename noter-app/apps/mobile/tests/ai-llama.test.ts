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
  loadedContextTokens,
  localPromptBudgetChars,
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

  it('tracks the resident context window and exposes a budget that scales with it', () => {
    // Smaller windows yield smaller prompt budgets; both reserve response + overhead.
    const small = localPromptBudgetChars(1024, 512);
    const large = localPromptBudgetChars(4096, 512);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    // A bigger reserved response shrinks the prompt budget.
    expect(localPromptBudgetChars(4096, 2048)).toBeLessThan(large);
    // Unknown sizes fall back to a safe 4096/512 default, never NaN/0.
    expect(localPromptBudgetChars(undefined, undefined)).toBe(large);
    expect(localPromptBudgetChars(0, 0)).toBe(large);
  });

  it('bounds a long thread to the resident window — keeps the system prompt + newest turn, drops the oldest', async () => {
    let captured: any[] = [];
    mockCompletion.mockImplementation(async (params: any) => {
      captured = params.messages;
      return { text: 'ok' };
    });
    await loadLlamaModel('/docs/m.gguf'); // 0-byte mock → 4096-token window
    expect(loadedContextTokens()).toBe(4096);

    const huge = 'x'.repeat(20000); // each turn alone is ~2x the ~8.9k-char budget
    const history = [
      { id: 's', role: 'system', content: 'PERSONA', createdAt: '' },
      { id: '1', role: 'user', content: `oldest ${huge}`, createdAt: '' },
      { id: '2', role: 'assistant', content: `mid ${huge}`, createdAt: '' },
      { id: '3', role: 'user', content: 'newest question', createdAt: '' },
    ] as any[];
    await completeLlama(history, {});

    const roles = captured.map((m) => m.role);
    const contents = captured.map((m) => m.content);
    expect(contents).toContain('PERSONA');           // system prompt is never evicted
    expect(roles[0]).toBe('system');                 // ...and stays first
    expect(contents).toContain('newest question');   // the current question is kept
    expect(contents.some((c: string) => c.startsWith('oldest '))).toBe(false); // oldest dropped
    const total = contents.reduce((n: number, c: string) => n + c.length, 0);
    expect(total).toBeLessThan(20000);               // well under a single huge turn
  });
});
