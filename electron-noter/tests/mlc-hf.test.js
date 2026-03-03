const { searchModels, getModelFiles } = require('../src/mlc');

describe('mlc huggingface helpers', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('searchModels maps results', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{ id: 'user/model', downloads: 10, likes: 2 }]),
    });
    const results = await searchModels('model');
    expect(results[0].id).toBe('user/model');
    expect(results[0].name).toBe('model');
  });

  it('getModelFiles filters gguf and sets urls', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tree: [
          { path: 'file.txt', size: 1 },
          { path: 'model.Q4_K_M.gguf', size: 123 },
        ],
      }),
    });
    const files = await getModelFiles('user/model');
    expect(files.length).toBe(1);
    expect(files[0].filename).toBe('model.Q4_K_M.gguf');
    expect(files[0].url).toContain('https://huggingface.co/user/model/resolve/main/model.Q4_K_M.gguf');
  });
});
