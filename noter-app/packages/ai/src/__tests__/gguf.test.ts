import { parseGGUF } from '../gguf';

// Mock the external library
jest.mock('@huggingface/gguf', () => ({
  gguf: jest.fn().mockResolvedValue({
    metadata: {
      'general.architecture': 'llama',
      'llama.context_length': 4096,
      'general.quantization_version': 2,
      'tensor_count': 100,
      'version': 3
    }
  })
}));

describe('GGUF Parser', () => {
  it('should parse metadata correctly', async () => {
    const info = await parseGGUF('https://example.com/model.gguf');
    
    expect(info.architecture).toBe('llama');
    expect(info.contextLength).toBe(4096);
    expect(info.quantizationVersion).toBe(2);
    expect(info.tensorCount).toBe(100);
    expect(info.version).toBe(3);
  });
});
