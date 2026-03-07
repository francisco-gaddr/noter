import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import { ensureDir, getCompiledUrl, getModelDir, getModelsBaseDir, getZipPath } from './mlcStorage';

export type ConversionStatus = 'queued' | 'downloading' | 'converting' | 'zipping' | 'completed' | 'failed';

export type ConversionJob = {
  id: string;
  modelId: string;
  ggufUrl: string;
  quant: string;
  platform: 'iphone' | 'android';
  status: ConversionStatus;
  progress: number;
  outputUrl?: string;
  message?: string;
  updatedAt: number;
};

const jobs = new Map<string, ConversionJob>();
let healthCache: {
  checkedAt: number;
  value: {
    mode: 'external' | 'local';
    externalEndpoint?: string;
    localBinary?: string;
    localBinaryAvailable: boolean;
    storageDir: string;
    storageWritable: boolean;
  };
} | null = null;

const normalizeQuant = (quant?: string) => (quant || 'Q4_K_M').toUpperCase();

const toMlcQuant = (quant: string) => {
  const map: Record<string, string> = {
    Q4_K_M: 'q4f16_1',
    Q4_0: 'q4f16_1',
    Q5_K_M: 'q5f16_1',
    Q5_0: 'q5f16_1',
    Q8_0: 'q8f16_1',
  };
  return map[quant] || quant.toLowerCase();
};

const updateJob = (jobId: string, patch: Partial<ConversionJob>) => {
  const existing = jobs.get(jobId);
  if (!existing) return;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  jobs.set(jobId, next);
};

const downloadFile = async (url: string, target: string) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status}`);
  }
  await ensureDir(path.dirname(target));
  const fileStream = await fs.open(target, 'w');
  await pipeline(res.body as any, fileStream.createWriteStream());
};

const zipDirectory = async (sourceDir: string, zipPath: string) => {
  await ensureDir(path.dirname(zipPath));
  return new Promise<void>((resolve, reject) => {
    const output = require('fs').createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
};

const runLocalConversion = async (job: ConversionJob) => {
  const quant = normalizeQuant(job.quant);
  const outDir = getModelDir(job.modelId, job.platform, quant);
  await ensureDir(outDir);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noter-mlc-'));
  const ggufPath = path.join(tmpDir, 'model.gguf');

  updateJob(job.id, { status: 'downloading', progress: 0.1 });
  await downloadFile(job.ggufUrl, ggufPath);

  updateJob(job.id, { status: 'converting', progress: 0.4 });
  const bin = process.env.MLC_LLM_BIN || 'mlc_llm';
  const args = [
    'convert',
    ggufPath,
    '--quantization',
    toMlcQuant(quant),
    '--target',
    job.platform,
    '-o',
    outDir,
  ];
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mlc_llm exited with ${code}`));
    });
    proc.on('error', reject);
  });

  updateJob(job.id, { status: 'zipping', progress: 0.8 });
  const zipPath = getZipPath(job.modelId, job.platform, quant);
  await zipDirectory(outDir, zipPath);

  updateJob(job.id, { status: 'completed', progress: 1, outputUrl: getCompiledUrl(job.modelId, job.platform, quant) });
};

const runExternalConversion = async (job: ConversionJob) => {
  const endpoint = process.env.MLC_CONVERTER_ENDPOINT;
  if (!endpoint) {
    throw new Error('Converter not configured');
  }
  updateJob(job.id, { status: 'converting', progress: 0.4 });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: job.modelId,
      ggufUrl: job.ggufUrl,
      quant: job.quant,
      platform: job.platform,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Converter failed: ${res.status} ${text.substring(0, 120)}`);
  }
  const data = await res.json().catch(() => ({}));
  const outputUrl = data.outputUrl || data.url;
  if (!outputUrl) {
    throw new Error('Converter missing outputUrl');
  }
  updateJob(job.id, { status: 'completed', progress: 1, outputUrl });
};

export const createConversionJob = (input: {
  modelId: string;
  ggufUrl: string;
  quant?: string;
  platform: 'iphone' | 'android';
}) => {
  const id = require('crypto').randomUUID();
  const job: ConversionJob = {
    id,
    modelId: input.modelId,
    ggufUrl: input.ggufUrl,
    quant: normalizeQuant(input.quant),
    platform: input.platform,
    status: 'queued',
    progress: 0,
    updatedAt: Date.now(),
  };
  jobs.set(id, job);

  Promise.resolve()
    .then(async () => {
      if (process.env.MLC_CONVERTER_ENDPOINT) {
        await runExternalConversion(job);
      } else {
        await runLocalConversion(job);
      }
    })
    .catch((error: any) => {
      updateJob(id, { status: 'failed', message: error?.message || 'Conversion failed' });
    });

  return id;
};

export const getConversionJob = (id: string) => {
  return jobs.get(id) || null;
};

export const getConversionHealth = async () => {
  const now = Date.now();
  if (healthCache && now - healthCache.checkedAt < 30_000) {
    return healthCache.value;
  }

  const externalEndpoint = process.env.MLC_CONVERTER_ENDPOINT;
  const storageDir = getModelsBaseDir();
  let storageWritable = false;
  try {
    await ensureDir(storageDir);
    const testFile = path.join(storageDir, `.health-${now}.tmp`);
    await fs.writeFile(testFile, 'ok', 'utf8');
    await fs.unlink(testFile).catch(() => {});
    storageWritable = true;
  } catch {
    storageWritable = false;
  }

  if (externalEndpoint) {
    const value = {
      mode: 'external' as const,
      externalEndpoint,
      localBinaryAvailable: false,
      storageDir,
      storageWritable,
    };
    healthCache = { checkedAt: now, value };
    return value;
  }

  const localBinary = process.env.MLC_LLM_BIN || 'mlc_llm';
  const localBinaryAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn(localBinary, ['--help'], { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 3000);
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });

  const value = {
    mode: 'local' as const,
    localBinary,
    localBinaryAvailable,
    storageDir,
    storageWritable,
  };
  healthCache = { checkedAt: now, value };
  return value;
};
