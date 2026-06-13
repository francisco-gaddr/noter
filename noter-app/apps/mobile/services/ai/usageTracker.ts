/**
 * Local AI usage tracking for third-party API providers.
 *
 * Records calls + tokens per provider/model and reports usage for "today" and the
 * current month ("period") against each provider's published free-tier limits, so
 * the AI screen can show "X / Y calls today" without any server round-trip. All
 * state lives in AsyncStorage on the device.
 *
 * The reducer (applyUsage) is pure and date-injected so it is unit-tested without
 * a clock or storage; the IO wrapper (recordUsage/getUsageSnapshot) adds the
 * AsyncStorage layer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProviderType } from './apiProviders';

const STORAGE_KEY = 'ai_usage_v1';

export interface UsageRecord {
  day: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  callsDay: number;
  tokensDay: number;
  callsMonth: number;
  tokensMonth: number;
}

export type UsageState = Record<string, UsageRecord>;

export interface ProviderLimit {
  /** Requests per day (free tier). null = no published hard daily cap. */
  callsPerDay: number | null;
  /** Tokens per minute is the usual throttle, but per-day token budget is what we surface. */
  tokensPerDay: number | null;
}

// Published free-tier ballparks (2026). These move often — treat as guidance, not
// gospel; update here in one place. Used only to render a "used / limit" hint.
export const PROVIDER_LIMITS: Record<ApiProviderType, ProviderLimit> = {
  gemini: { callsPerDay: 1500, tokensPerDay: 1_000_000 },
  groq: { callsPerDay: 1000, tokensPerDay: 500_000 },
  openrouter: { callsPerDay: 50, tokensPerDay: null }, // free models: ~50/day
  hermes: { callsPerDay: null, tokensPerDay: null }, // self-hosted — no provider cap
};

export const usageKey = (provider: ApiProviderType | string, model: string): string => `${provider}::${model}`;

export const emptyRecord = (day: string, month: string): UsageRecord => ({
  day,
  month,
  callsDay: 0,
  tokensDay: 0,
  callsMonth: 0,
  tokensMonth: 0,
});

/**
 * Pure reducer: fold one call (with `tokens`) into a record, rolling the day and
 * month buckets over when the date has advanced. `day`/`month` are injected.
 */
export const applyUsage = (
  prev: UsageRecord | undefined,
  tokens: number,
  day: string,
  month: string,
): UsageRecord => {
  const base = prev ?? emptyRecord(day, month);
  const dayRolled = base.day !== day;
  const monthRolled = base.month !== month;
  const safeTokens = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
  return {
    day,
    month,
    callsDay: (dayRolled ? 0 : base.callsDay) + 1,
    tokensDay: (dayRolled ? 0 : base.tokensDay) + safeTokens,
    callsMonth: (monthRolled ? 0 : base.callsMonth) + 1,
    tokensMonth: (monthRolled ? 0 : base.tokensMonth) + safeTokens,
  };
};

export interface UsageSnapshot extends UsageRecord {
  provider: ApiProviderType | string;
  model: string;
  limit: ProviderLimit;
}

const todayParts = (now: Date): { day: string; month: string } => {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
};

const readState = async (): Promise<UsageState> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Record a successful API call. Non-fatal on failure (best-effort metrics). */
export const recordUsage = async (
  provider: ApiProviderType | string,
  model: string,
  tokens: number,
  now: Date = new Date(),
): Promise<void> => {
  try {
    const { day, month } = todayParts(now);
    const state = await readState();
    const key = usageKey(provider, model);
    state[key] = applyUsage(state[key], tokens, day, month);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* metrics are best-effort */
  }
};

/** Snapshot for one provider/model, with day/month buckets reset if stale. */
export const getUsageSnapshot = async (
  provider: ApiProviderType | string,
  model: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> => {
  const { day, month } = todayParts(now);
  const state = await readState();
  const rec = state[usageKey(provider, model)];
  const fresh: UsageRecord = rec
    ? {
        day,
        month,
        callsDay: rec.day === day ? rec.callsDay : 0,
        tokensDay: rec.day === day ? rec.tokensDay : 0,
        callsMonth: rec.month === month ? rec.callsMonth : 0,
        tokensMonth: rec.month === month ? rec.tokensMonth : 0,
      }
    : emptyRecord(day, month);
  // Custom/unknown providers (e.g. a user-added Hermes agent) have no published
  // limit — fall back to "no cap" so the snapshot still renders.
  const limit = PROVIDER_LIMITS[provider as ApiProviderType] ?? { callsPerDay: null, tokensPerDay: null };
  return { ...fresh, provider, model, limit };
};
