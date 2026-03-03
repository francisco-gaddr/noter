import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import archiver from 'archiver';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

type JobStatus = 'queued' | 'downloading' | 'converting' | 'zipping' | 'completed' | 'failed';

type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  message?: string;
  outputUrl?: string;
  outputPath?: string;
};

const getBaseUrl = (origin?: string | null) =>
  (process.env.NEXT_PUBLIC_MLC_MODELS_BASE_URL || process.env.MLC_MODELS_BASE_URL || (origin ? `${origin}/mlc-models` : 'https://daylited.com/mlc-models')).replace(/\/$/, '');

const getJobStore = () => {
  const store = (globalThis as any).__mlcJobs as Map<string, Job> | undefined;
  if (store) return store;
  const created = new Map<string, Job>();
  (globalThis as any).__mlcJobs = created;
  return created;
};

const normalizeQuant = (value?: string | null) => (value || 'Q4_K_M').toUpperCase();

const resolveMlcQuant = (quant: string) => {
  const map: Record<string, string> = {
    Q4_K_M: 'q4f16_1',
    Q5_K_M: 'q5f16_1',
    Q4_0: 'q4f16_1',
    Q5_0: 'q5f16_1',
    Q8_0: 'q8f16_1',
  };
  return map[quant] || 'q4f16_1';
};

const ensureDir = async (dir: string) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

const downloadFile = async (url: string, dest: string, onProgress: (progress: number) => void) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Download failed');
  const total = Number(res.headers.get('content-length') || 0);
  await ensureDir(path.dirname(dest));
  const fileStream = fs.createWriteStream(dest);
  let received = 0;
  const nodeStream = Readable.fromWeb(res.body as any) as NodeJS.ReadableStream;
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) onProgress(Math.min(0.4, (received / total) * 0.4));
  });
  await pipeline(nodeStream, fileStream);
};

const runConvert = async (ggufPath: string, outDir: string, quant: string, target: 'iphone' | 'android', onProgress: (progress: number) => void) => {
  await ensureDir(outDir);
  const args = ['convert', ggufPath, '--quantization', resolveMlcQuant(quant), '--target', target, '-o', outDir];
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('mlc_llm', args, { stdio: 'ignore' });
    onProgress(0.6);
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        onProgress(0.8);
        resolve();
      } else {
        reject(new Error('Conversion failed'));
      }
    });
  });
};

const zipDir = async (sourceDir: string, zipPath: string, onProgress: (progress: number) => void) => {
  await ensureDir(path.dirname(zipPath));
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      onProgress(1);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
    onProgress(0.9);
  });
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const modelId = String(body?.modelId || '');
    const ggufUrl = String(body?.ggufUrl || '');
    const quant = normalizeQuant(body?.quant);
    const platform = body?.platform === 'android' ? 'android' : 'iphone';

    if (!modelId || !ggufUrl) {
      return new Response(JSON.stringify({ error: 'modelId and ggufUrl required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const jobId = crypto.randomUUID();
    const jobs = getJobStore();
    const job: Job = { id: jobId, status: 'queued', progress: 0 };
    jobs.set(jobId, job);

    const origin = new URL(req.url).origin;
    const baseUrl = getBaseUrl(origin);
    const encodedModel = encodeURIComponent(modelId);
    const publicDir = path.join(process.cwd(), 'public', 'mlc-models', platform, encodedModel);
    const outputZip = path.join(publicDir, `${quant}.zip`);
    const outputUrl = `${baseUrl}/${platform}/${encodedModel}/${quant}.zip`;

    const cacheDir = path.join(process.cwd(), '.cache', 'mlc', jobId);
    const ggufPath = path.join(cacheDir, 'model.gguf');
    const outDir = path.join(cacheDir, 'mlc');

    const update = (next: Partial<Job>) => {
      const current = jobs.get(jobId);
      if (!current) return;
      jobs.set(jobId, { ...current, ...next });
    };

    update({ status: 'downloading', progress: 0.1 });

    (async () => {
      try {
        await downloadFile(ggufUrl, ggufPath, (p) => update({ progress: p, status: 'downloading' }));
        update({ status: 'converting', progress: 0.5 });
        await runConvert(ggufPath, outDir, quant, platform, (p) => update({ progress: p, status: 'converting' }));
        const configPath = path.join(outDir, 'mlc-chat-config.json');
        const hasConfig = fs.existsSync(configPath);
        if (!hasConfig) throw new Error('Invalid model package');
        update({ status: 'zipping', progress: 0.9 });
        await zipDir(outDir, outputZip, (p) => update({ progress: p, status: 'zipping' }));
        update({ status: 'completed', progress: 1, outputUrl, outputPath: outputZip });
      } catch (error: any) {
        update({ status: 'failed', message: error.message || 'Conversion failed' });
      }
    })();

    return new Response(JSON.stringify({ jobId }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'jobId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const jobs = getJobStore();
    const job = jobs.get(jobId);
    if (!job) {
      return new Response(JSON.stringify({ error: 'job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(job), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
