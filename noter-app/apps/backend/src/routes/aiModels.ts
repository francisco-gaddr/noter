import express, { Request, Response } from 'express';
import { createConversionJob, getConversionHealth, getConversionJob } from '../services/ai/conversionService';
import { getCompiledUrl, getZipPath, zipExists } from '../services/ai/mlcStorage';

const router = express.Router();

const json = (res: Response, body: any, status = 200) => {
  res.status(status).json(body);
};

const fetchJson = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text.substring(0, 120)}`);
  }
  return res.json();
};

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length > 128) return json(res, { error: 'q too long' }, 400);
    if (!q) return json(res, []);
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=20`;
    const data = await fetchJson(url);
    const models = Array.isArray(data) ? data : [];
    const normalized = models.map((model: any) => ({
      id: model.id,
      author: model.author || model.id?.split?.('/')[0],
      name: model.id?.split?.('/')[1] || model.id,
      downloads: model.downloads || 0,
      likes: model.likes || 0,
      tags: model.tags || [],
    }));
    return json(res, normalized);
  } catch (error: any) {
    return json(res, { error: error?.message || 'Search failed' }, 500);
  }
});

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await getConversionHealth();
    return json(res, health);
  } catch (error: any) {
    return json(res, { error: error?.message || 'Health check failed' }, 500);
  }
});

router.get('/files', async (req: Request, res: Response) => {
  try {
    const modelId = String(req.query.modelId || '').trim();
    if (modelId.length > 128) return json(res, { error: 'modelId too long' }, 400);
    if (!modelId) return json(res, { error: 'modelId required' }, 400);
    const url = `https://huggingface.co/api/models/${encodeURIComponent(modelId)}`;
    const data = await fetchJson(url);
    const siblings = Array.isArray(data?.siblings) ? data.siblings : [];
    const ggufs = siblings
      .map((file: any) => ({
        filename: file.rfilename || file.path,
        size: file.size || 0,
        url: `https://huggingface.co/${modelId}/resolve/main/${file.rfilename || file.path}`,
        quantization: extractQuantization(file.rfilename || file.path),
      }))
      .filter((file: any) => String(file.filename || '').endsWith('.gguf'));
    return json(res, ggufs);
  } catch (error: any) {
    return json(res, { error: error?.message || 'Files fetch failed' }, 500);
  }
});

router.get('/compiled', async (req: Request, res: Response) => {
  const modelId = String(req.query.modelId || '').trim();
  const platform = String(req.query.platform || '').trim() as 'iphone' | 'android';
  const quant = String(req.query.quant || '').trim();
  if (modelId.length > 128) {
    return json(res, { error: 'modelId too long' }, 400);
  }
  if (!modelId || (platform !== 'iphone' && platform !== 'android')) {
    return json(res, { error: 'modelId and platform required' }, 400);
  }
  const url = getCompiledUrl(modelId, platform, quant);
  const available = await zipExists(modelId, platform, quant);
  const filename = `${(quant || 'Q4_K_M').toUpperCase()}.zip`;
  return json(res, { url, filename, available });
});

router.get('/compiled-file', async (req: Request, res: Response) => {
  const modelId = String(req.query.modelId || '').trim();
  const platform = String(req.query.platform || '').trim();
  const quant = String(req.query.quant || '').trim();
  if (!modelId || !platform) {
    return json(res, { error: 'modelId and platform required' }, 400);
  }
  if (modelId.length > 128) {
    return json(res, { error: 'modelId too long' }, 400);
  }
  const exists = await zipExists(modelId, platform, quant);
  if (!exists) return json(res, { error: 'Not found' }, 404);
  const zipPath = getZipPath(modelId, platform, quant);
  return res.sendFile(zipPath);
});

router.post('/convert', async (req: Request, res: Response) => {
  const modelId = String(req.body?.modelId || '').trim();
  const ggufUrl = String(req.body?.ggufUrl || '').trim();
  const quant = String(req.body?.quant || req.body?.quantization || 'Q4_K_M').trim();
  const platform = String(req.body?.platform || '').trim() as 'iphone' | 'android';
  if (!modelId || !ggufUrl || (platform !== 'iphone' && platform !== 'android')) {
    return json(res, { error: 'modelId, ggufUrl, platform required' }, 400);
  }
  if (modelId.length > 128) {
    return json(res, { error: 'modelId too long' }, 400);
  }
  if (!/^https?:\/\//i.test(ggufUrl)) {
    return json(res, { error: 'Invalid ggufUrl' }, 400);
  }
  if (!/huggingface\.co/i.test(ggufUrl) && !process.env.ALLOW_EXTERNAL_GGUF_URLS) {
    return json(res, { error: 'Only huggingface.co ggufUrl is allowed' }, 400);
  }
  const jobId = createConversionJob({ modelId, ggufUrl, quant, platform });
  return json(res, { jobId });
});

router.get('/convert', async (req: Request, res: Response) => {
  const jobId = String(req.query.jobId || '').trim();
  if (!jobId) return json(res, { error: 'jobId required' }, 400);
  const job = getConversionJob(jobId);
  if (!job) return json(res, { status: 'failed', message: 'Job not found' }, 404);
  return json(res, {
    status: job.status,
    progress: job.progress,
    outputUrl: job.outputUrl,
    message: job.message,
  });
});

const extractQuantization = (filename?: string) => {
  if (!filename) return undefined;
  const match = filename.match(/(q\d_[0-9a-z_]+|f16|f32)/i);
  return match?.[1] ? match[1].toUpperCase() : undefined;
};

export default router;
