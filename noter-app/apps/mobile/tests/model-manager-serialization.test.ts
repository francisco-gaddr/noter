/**
 * ModelManager serialization + integrity contract. These lock the fixes for the native local-model
 * crashes: (1) a model switch/unload must NEVER free the llama.rn context while a completion streams
 * (SIGSEGV), and (2) a corrupt/partial GGUF must never reach native initLlama (SIGABRT).
 */

jest.mock('../services/ai/llama', () => ({
  isLlamaLinked: () => true,
  isLlamaLoaded: jest.fn(() => true),
  loadedModelPath: jest.fn(() => '/models/a.gguf'),
  loadedContextTokens: jest.fn(() => 2048),
  loadLlamaModel: jest.fn(async () => {}),
  unloadLlamaModel: jest.fn(async () => {}),
  completeLlama: jest.fn(async () => 'answer'),
}));
jest.mock('../services/ai/ModelDownloader', () => ({
  modelFileExists: jest.fn(async () => true),
  verifyModelFile: jest.fn(async () => true),
}));

const freshManager = () => {
  let mod: any;
  jest.isolateModules(() => { mod = require('../services/ai/ModelManager'); });
  return mod.modelManager;
};

describe('ModelManager serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const llama = require('../services/ai/llama');
    llama.isLlamaLoaded.mockReturnValue(true);
    llama.loadedModelPath.mockReturnValue('/models/a.gguf');
    llama.completeLlama.mockImplementation(async () => 'answer');
    llama.loadLlamaModel.mockImplementation(async () => {});
    llama.unloadLlamaModel.mockImplementation(async () => {});
    const dl = require('../services/ai/ModelDownloader');
    dl.verifyModelFile.mockResolvedValue(true);
    dl.modelFileExists.mockResolvedValue(true);
  });

  it('unload() waits for an in-flight completion — the native context is never freed mid-stream', async () => {
    const llama = require('../services/ai/llama');
    let resolveCompletion!: (v: string) => void;
    llama.completeLlama.mockImplementation(() => new Promise((r) => { resolveCompletion = r; }));

    const mgr = freshManager();
    const order: string[] = [];

    const completeP = mgr.complete([{ role: 'user', content: 'hi' }]).then(() => order.push('complete'));
    await new Promise((r) => setTimeout(r, 0)); // let complete() enter the mutex + invoke completeLlama
    const unloadP = mgr.unload().then(() => order.push('unload'));

    // The release must NOT have happened yet — a completion is streaming.
    expect(llama.unloadLlamaModel).not.toHaveBeenCalled();

    resolveCompletion('done');
    await Promise.all([completeP, unloadP]);

    expect(llama.unloadLlamaModel).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['complete', 'unload']); // strict order: completion first, release after
  });

  it('a model-switch load() waits for an in-flight completion before touching the native context', async () => {
    const llama = require('../services/ai/llama');
    let resolveCompletion!: (v: string) => void;
    llama.completeLlama.mockImplementation(() => new Promise((r) => { resolveCompletion = r; }));

    const mgr = freshManager();
    const completeP = mgr.complete([{ role: 'user', content: 'hi' }]);
    await new Promise((r) => setTimeout(r, 0));

    // Switch to a DIFFERENT model while the completion is live.
    llama.loadedModelPath.mockReturnValue('/models/a.gguf'); // current != target
    const loadP = mgr.load('/models/b.gguf');

    expect(llama.loadLlamaModel).not.toHaveBeenCalled(); // load hasn't started — completion holds the mutex
    resolveCompletion('done');
    await Promise.all([completeP, loadP]);
    expect(llama.loadLlamaModel).toHaveBeenCalledWith('/models/b.gguf', {}, undefined);
  });

  it('integrity gate: load() rejects a corrupt GGUF and NEVER calls native initLlama', async () => {
    const llama = require('../services/ai/llama');
    const dl = require('../services/ai/ModelDownloader');
    dl.verifyModelFile.mockResolvedValue(false); // corrupt/partial
    llama.isLlamaLoaded.mockReturnValue(false);
    llama.loadedModelPath.mockReturnValue(null);

    const mgr = freshManager();
    await expect(mgr.load('/models/corrupt.gguf')).rejects.toThrow(/skadad eller ofullständig/);
    expect(llama.loadLlamaModel).not.toHaveBeenCalled();
  });
});
