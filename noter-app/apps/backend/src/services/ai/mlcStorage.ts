import path from 'path';
import fs from 'fs/promises';

const normalizeQuant = (quant?: string) => (quant || 'Q4_K_M').toUpperCase();

const safeModelId = (modelId: string) =>
  modelId.replace(/[^a-zA-Z0-9._-]/g, '_');

export const getModelsBaseDir = () => {
  const base = process.env.MLC_MODELS_DIR;
  if (base) return base;
  return path.join(process.cwd(), 'data', 'mlc_models');
};

export const getModelDir = (modelId: string, platform: string, quant?: string) => {
  const safe = safeModelId(modelId);
  const q = normalizeQuant(quant);
  return path.join(getModelsBaseDir(), platform, safe, q);
};

export const getZipPath = (modelId: string, platform: string, quant?: string) => {
  const safe = safeModelId(modelId);
  const q = normalizeQuant(quant);
  return path.join(getModelsBaseDir(), platform, safe, `${q}.zip`);
};

export const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

export const getCompiledUrl = (modelId: string, platform: string, quant?: string) => {
  const baseUrl = process.env.MLC_MODELS_BASE_URL?.replace(/\/$/, '');
  const q = normalizeQuant(quant);
  if (baseUrl) {
    return `${baseUrl}/${platform}/${encodeURIComponent(modelId)}/${q}.zip`;
  }
  const apiBase = process.env.API_PUBLIC_BASE_URL?.replace(/\/$/, '') || '';
  const prefix = apiBase ? `${apiBase}/api/ai/models/compiled-file` : '/api/ai/models/compiled-file';
  return `${prefix}?modelId=${encodeURIComponent(modelId)}&platform=${encodeURIComponent(platform)}&quant=${encodeURIComponent(q)}`;
};

export const zipExists = async (modelId: string, platform: string, quant?: string) => {
  const zipPath = getZipPath(modelId, platform, quant);
  try {
    await fs.access(zipPath);
    return true;
  } catch {
    return false;
  }
};
