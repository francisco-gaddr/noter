import { recordStartupBootstrap } from '@/services/perfMetrics';

export const runStartupBootstrap = async (
  init: () => Promise<void>,
  onError?: (message: string, error: unknown) => void
) => {
  const startedAt = Date.now();
  try {
    await init();
    recordStartupBootstrap(true, Date.now() - startedAt);
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Appstart misslyckades';
    recordStartupBootstrap(false, Date.now() - startedAt, message);
    onError?.(message, error);
    return { ok: false as const, message };
  }
};
