const path = require('path');
const { resolveQuant, ensureModelDir, shouldRetryOnCpu } = require('../src/mlc');

describe('mlc utilities', () => {
  it('maps quantization to mlc values', () => {
    expect(resolveQuant('Q4_K_M')).toBe('q4f16_1');
    expect(resolveQuant('Q5_K_M')).toBe('q5f16_1');
    expect(resolveQuant('Q8_0')).toBe('q8f16_1');
  });

  it('builds stable model directory', () => {
    const base = path.join('C:', 'temp');
    const dir = ensureModelDir(base, 'user/model', 'Q4_K_M');
    expect(dir).toContain(path.join('mlc_models', 'user_model', 'Q4_K_M'));
  });

  it('retries on GPU-related runtime failures only', () => {
    expect(shouldRetryOnCpu(new Error('CUDA driver failed'))).toBe(true);
    expect(shouldRetryOnCpu(new Error('GPU device unavailable'))).toBe(true);
    expect(shouldRetryOnCpu(new Error('model package invalid'))).toBe(false);
  });
});
