export const runStartupBootstrap = async (
  init: () => Promise<void>,
  onError?: (message: string, error: unknown) => void
) => {
  try {
    await init();
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Appstart misslyckades';
    onError?.(message, error);
    return { ok: false as const, message };
  }
};
