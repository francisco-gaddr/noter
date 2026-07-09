/**
 * Local AI usage tracking for third-party API providers (web/Electron).
 *
 * Mirrors apps/mobile/services/ai/usageTracker.ts: records calls + tokens per
 * provider/model and reports usage for "today" and the current month against
 * each provider's published free-tier limits, so the AI panel can show
 * "X / Y calls today" without a server round-trip. State lives in localStorage.
 *
 * The reducer (applyUsage) is pure and date-injected so it is unit-tested without
 * a clock or storage; the IO wrapper (recordUsage/getUsageSnapshot) adds the
 * localStorage layer.
 */
import { encrypt, safeDecrypt, applyToolUsage, toolUsageSummary, type ToolUsageState, type ToolUsageRow } from '@repo/shared';
import type { ApiProviderType } from './apiProviders';

const STORAGE_KEY = 'ai_usage_v1';
const TOOL_STORAGE_KEY = 'ai_tool_usage_v1';

// Usage state is stored ENCRYPTED at rest (defence-in-depth; parity with the rest of
// the AI local store). safeDecrypt transparently reads any legacy plaintext value.
const readEncryptedJson = <T>(key: string, fallback: T): T => {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(safeDecrypt(raw, raw) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};
const writeEncryptedJson = (key: string, value: unknown): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, encrypt(JSON.stringify(value)));
  } catch {
    /* best-effort */
  }
};

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
  openai: { callsPerDay: null, tokensPerDay: null }, // paid usage-based — no fixed free cap
  anthropic: { callsPerDay: null, tokensPerDay: null }, // paid usage-based
  grok: { callsPerDay: null, tokensPerDay: null }, // paid usage-based
  hermes: { callsPerDay: null, tokensPerDay: null }, // self-hosted — no provider cap
  lmstudio: { callsPerDay: null, tokensPerDay: null }, // local LM Studio server — no provider cap
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

const readState = (): UsageState => readEncryptedJson<UsageState>(STORAGE_KEY, {});

/** Record a successful API call. Non-fatal on failure (best-effort metrics). */
export const recordUsage = (
  provider: ApiProviderType | string,
  model: string,
  tokens: number,
  now: Date = new Date(),
): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    const { day, month } = todayParts(now);
    const state = readState();
    const key = usageKey(provider, model);
    state[key] = applyUsage(state[key], tokens, day, month);
    writeEncryptedJson(STORAGE_KEY, state);
  } catch {
    /* metrics are best-effort */
  }
};

/** Record one AI tool/skill call (e.g. create_task, mcp_call_tool). Best-effort, encrypted. */
export const recordToolUse = (tool: string, now: Date = new Date()): void => {
  try {
    if (!tool || typeof localStorage === 'undefined') return;
    const { day, month } = todayParts(now);
    const state = readEncryptedJson<ToolUsageState>(TOOL_STORAGE_KEY, {});
    state[tool] = applyToolUsage(state[tool], day, month);
    writeEncryptedJson(TOOL_STORAGE_KEY, state);
  } catch {
    /* best-effort */
  }
};

/** Sorted per-tool usage rows (most-used first) for the admin statistics panel. */
export const getToolUsageRows = (now: Date = new Date()): ToolUsageRow[] => {
  const { day, month } = todayParts(now);
  return toolUsageSummary(readEncryptedJson<ToolUsageState>(TOOL_STORAGE_KEY, {}), day, month);
};

/** All provider/model usage rows (for the admin token/calls table). */
export const getAllUsageRows = (now: Date = new Date()): UsageSnapshot[] => {
  const { day, month } = todayParts(now);
  const state = readState();
  return Object.entries(state).map(([k, rec]) => {
    const [provider, model] = k.split('::');
    return {
      day, month,
      callsDay: rec.day === day ? rec.callsDay : 0,
      tokensDay: rec.day === day ? rec.tokensDay : 0,
      callsMonth: rec.month === month ? rec.callsMonth : 0,
      tokensMonth: rec.month === month ? rec.tokensMonth : 0,
      provider, model,
      limit: PROVIDER_LIMITS[provider as ApiProviderType] ?? { callsPerDay: null, tokensPerDay: null },
    };
  });
};

/** Snapshot for one provider/model, with day/month buckets reset if stale. */
export const getUsageSnapshot = (
  provider: ApiProviderType | string,
  model: string,
  now: Date = new Date(),
): UsageSnapshot => {
  const { day, month } = todayParts(now);
  const state = readState();
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
