type IncrementResult = { totalHits: number };
type Incrementer = (key: string) => Promise<IncrementResult>;

type Options = {
  windowMs: number;
  max: number;
  increment?: Incrementer;
  memoryMaxKeys?: number;
};

type CheckResult = {
  allowed: boolean;
  totalHits: number;
  source: 'redis' | 'memory';
};

export const createSocketConnectionAttemptLimiter = (options: Options) => {
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 60_000;
  const max = Number.isFinite(options.max) ? options.max : 45;
  const memoryMaxKeys =
    typeof options.memoryMaxKeys === 'number' && Number.isFinite(options.memoryMaxKeys)
      ? options.memoryMaxKeys
      : 10_000;

  const memory = new Map<string, { count: number; startedAt: number }>();

  const checkMemory = (key: string, now: number): CheckResult => {
    const entry = memory.get(key);
    if (!entry || now - entry.startedAt > windowMs) {
      memory.set(key, { count: 1, startedAt: now });
      return { allowed: true, totalHits: 1, source: 'memory' };
    }
    entry.count += 1;
    if (entry.count > max) {
      memory.set(key, entry);
      return { allowed: false, totalHits: entry.count, source: 'memory' };
    }
    memory.set(key, entry);
    return { allowed: true, totalHits: entry.count, source: 'memory' };
  };

  const pruneMemory = (now: number) => {
    if (memory.size <= memoryMaxKeys) return;
    for (const [key, entry] of memory.entries()) {
      if (now - entry.startedAt > windowMs) {
        memory.delete(key);
      }
    }
    if (memory.size <= memoryMaxKeys) return;
    let removed = 0;
    for (const key of memory.keys()) {
      memory.delete(key);
      removed += 1;
      if (memory.size <= memoryMaxKeys) break;
      if (removed > 2000) break;
    }
  };

  const check = async (key: string, now = Date.now()): Promise<CheckResult> => {
    const normalizedKey = String(key || '').trim() || 'unknown';

    if (options.increment) {
      try {
        const result = await options.increment(normalizedKey);
        const totalHits = Number.isFinite(result?.totalHits) ? result.totalHits : 1;
        return { allowed: totalHits <= max, totalHits, source: 'redis' };
      } catch {
      }
    }

    pruneMemory(now);
    return checkMemory(normalizedKey, now);
  };

  return { check };
};
