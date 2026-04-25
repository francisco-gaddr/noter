const DEFAULT_AI_SYNC_RETENTION_DAYS = 180;
const MIN_AI_SYNC_RETENTION_DAYS = 1;
const MAX_AI_SYNC_RETENTION_DAYS = 3650;

export const getAiSyncRetentionDays = () => {
  const raw = String(process.env.AI_SYNC_RETENTION_DAYS || '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_SYNC_RETENTION_DAYS;
  if (parsed < MIN_AI_SYNC_RETENTION_DAYS) return MIN_AI_SYNC_RETENTION_DAYS;
  if (parsed > MAX_AI_SYNC_RETENTION_DAYS) return MAX_AI_SYNC_RETENTION_DAYS;
  return parsed;
};

export const getAiSyncRetentionSeconds = () => getAiSyncRetentionDays() * 24 * 60 * 60;
