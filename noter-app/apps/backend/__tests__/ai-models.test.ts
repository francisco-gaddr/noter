import request from 'supertest';
import { app, server } from '../src/index';

jest.mock('../src/services/ai/conversionService', () => ({
  createConversionJob: jest.fn(() => 'job-1'),
  ensureConversionJob: jest.fn(() => ({ id: 'job-1', status: 'queued' })),
  getConversionJob: jest.fn(() => ({ status: 'completed', progress: 1, outputUrl: 'https://models.test/q4.zip' })),
  getConversionHealth: jest.fn(async () => ({
    mode: 'local',
    localBinary: 'mlc_llm',
    localBinaryAvailable: true,
    storageDir: '/tmp/mlc',
    storageWritable: true,
  })),
}));

describe('AI Models API', () => {
  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    (global.fetch as any) = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
      text: async () => '',
    });
    process.env.MLC_MODELS_BASE_URL = 'https://models.example.com';
  });

  it('returns compiled url', async () => {
    const res = await request(app).get('/api/ai/models/compiled').query({
      modelId: 'user/model',
      platform: 'iphone',
      quant: 'Q4_K_M',
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://models.example.com/iphone/user%2Fmodel/Q4_K_M.zip');
    expect(typeof res.body.available).toBe('boolean');
  });

  it('starts or reuses conversion job from compiled endpoint when package is missing', async () => {
    const res = await request(app).get('/api/ai/models/compiled').query({
      modelId: 'user/model',
      platform: 'android',
      quant: 'Q4_K_M',
      autoCreate: '1',
      ggufUrl: 'https://huggingface.co/user/model/resolve/main/model.Q4_K_M.gguf',
    });
    expect(res.status).toBe(202);
    expect(res.body.available).toBe(false);
    expect(res.body.jobId).toBe('job-1');
    expect(res.body.status).toBe('queued');
  });

  it('rejects compiled auto-create without valid huggingface gguf url', async () => {
    const res = await request(app).get('/api/ai/models/compiled').query({
      modelId: 'user/model',
      platform: 'android',
      quant: 'Q4_K_M',
      autoCreate: '1',
      ggufUrl: 'https://example.com/model.gguf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('huggingface.co');
  });

  it('starts conversion job', async () => {
    const res = await request(app).post('/api/ai/models/convert').send({
      modelId: 'user/model',
      ggufUrl: 'https://huggingface.co/user/model/resolve/main/model.Q4_K_M.gguf',
      quant: 'Q4_K_M',
      platform: 'iphone',
    });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job-1');
  });

  it('rejects non-huggingface gguf url by default', async () => {
    const res = await request(app).post('/api/ai/models/convert').send({
      modelId: 'user/model',
      ggufUrl: 'https://example.com/model.gguf',
      quant: 'Q4_K_M',
      platform: 'iphone',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('huggingface.co');
  });

  it('returns conversion status', async () => {
    const res = await request(app).get('/api/ai/models/convert').query({ jobId: 'job-1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.outputUrl).toBe('https://models.test/q4.zip');
  });

  it('returns conversion health', async () => {
    const res = await request(app).get('/api/ai/models/health');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('local');
    expect(res.body.localBinaryAvailable).toBe(true);
  });
});
