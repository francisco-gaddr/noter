/**
 * Hardware-aware sizing for on-device models.
 *
 * A GGUF needs roughly its file size resident in RAM, plus the KV-cache and engine
 * overhead. We budget conservatively against the device's total memory so the picker
 * can recommend a quant that will actually load + run, and warn before a too-large one.
 *
 * `expo-device.totalMemory` is bytes on Android; on iOS it can be undefined — every
 * helper degrades gracefully (returns null / "unknown") so the UI still works, just
 * without a tailored recommendation.
 */
import * as Device from 'expo-device';
import type { HFFile } from '@repo/ai';

/** Total device RAM in bytes, or null when the platform doesn't expose it. */
export const getTotalMemoryBytes = (): number | null => {
  try {
    const m = (Device as any).totalMemory;
    return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : null;
  } catch {
    return null;
  }
};

export type FitLevel = 'good' | 'tight' | 'risky' | 'unknown';

export interface ModelFit {
  level: FitLevel;
  label: string;
  /** True when this is a comfortable choice for the device. */
  recommended: boolean;
}

const GB = 1024 * 1024 * 1024;

/** Assess how a given model file size fits this device's RAM. */
export const assessModelFit = (fileBytes?: number): ModelFit => {
  const ram = getTotalMemoryBytes();
  if (!ram || !fileBytes || fileBytes <= 0) {
    return { level: 'unknown', label: '', recommended: false };
  }
  const comfortable = ram * 0.45; // leaves headroom for OS + app
  const max = ram * 0.6;
  if (fileBytes <= comfortable) return { level: 'good', label: 'Rekommenderad', recommended: true };
  if (fileBytes <= max) return { level: 'tight', label: 'Kan vara tungt', recommended: false };
  return { level: 'risky', label: 'Troligen för stor', recommended: false };
};

/** Short human description of the device RAM budget, or '' if unknown. */
export const describeHardwareBudget = (): string => {
  const ram = getTotalMemoryBytes();
  if (!ram) return '';
  const ramGb = ram / GB;
  const recGb = (ram * 0.45) / GB;
  return `Enhetens minne ≈ ${ramGb.toFixed(1)} GB · rekommenderad modellstorlek upp till ≈ ${recGb.toFixed(1)} GB`;
};

const QUANT_PREFERENCE = ['Q4_K_M', 'Q5_K_M', 'Q4_K_S', 'Q4_0', 'Q5_0', 'Q3_K_M', 'Q8_0'];

/**
 * Pick the best file for this device: the largest "good"-fitting quant, preferring the
 * balanced K_M variants. Falls back to the smallest file when nothing fits comfortably
 * (so there's always a sensible default), and to the old quant-priority when RAM is
 * unknown.
 */
export const recommendFileForDevice = (files: HFFile[]): HFFile | undefined => {
  const usable = (files || []).filter((f) => f && typeof f.size === 'number' && !/F16|F32/i.test(f.quantization || ''));
  const pool = usable.length ? usable : (files || []);
  if (pool.length === 0) return undefined;

  const ram = getTotalMemoryBytes();
  if (!ram) {
    // No RAM info: keep the previous quant-priority heuristic.
    for (const q of QUANT_PREFERENCE) {
      const f = pool.find((x) => (x.quantization || '').toUpperCase() === q);
      if (f) return f;
    }
    return [...pool].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
  }

  const good = pool.filter((f) => assessModelFit(f.size).level === 'good');
  const candidates = good.length ? good : pool;
  // Prefer a balanced quant among the candidates; else the largest comfortable one.
  for (const q of QUANT_PREFERENCE) {
    const f = candidates.find((x) => (x.quantization || '').toUpperCase() === q);
    if (f) return f;
  }
  return good.length
    ? [...good].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
    : [...pool].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
};

/** Format bytes as a compact size string (e.g. "1.8 GB", "640 MB"). */
export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};
