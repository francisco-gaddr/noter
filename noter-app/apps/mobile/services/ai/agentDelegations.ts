/**
 * Local, encrypted store of AI-task delegations, keyed by task id.
 *
 * The delegation (assignee=ai, model source, status, …) is kept OUTSIDE the synced
 * Task on purpose: the task itself syncs normally, while the agent config lives
 * only on this device (per the "local-only, always encrypted" requirement) and so
 * a sync round-trip can never strip it. The scheduler merges this map onto the
 * in-memory tasks; the executor updates it as a task runs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  encrypt, safeDecrypt, parseAiDelegation,
  extractDelegationDefaults, parseDelegationDefaults,
  type AiTaskDelegation, type DelegationDefaults, type Task,
} from '@repo/shared';

let cachedScope: string | null = null;
const scopeKey = async (): Promise<string> => {
  if (cachedScope) return cachedScope;
  const token = await SecureStore.getItemAsync('token').catch(() => null);
  cachedScope = token ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token) : 'anon';
  return cachedScope;
};
const storageKey = (scope: string) => `ai_task_delegations_${scope}`;
const defaultsStorageKey = (scope: string) => `ai_delegation_defaults_${scope}`;

export type DelegationMap = Record<string, AiTaskDelegation>;

export const getDelegations = async (): Promise<DelegationMap> => {
  try {
    const raw = await AsyncStorage.getItem(storageKey(await scopeKey()));
    if (!raw) return {};
    const parsed = JSON.parse(safeDecrypt(raw, raw) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: DelegationMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      const d = parseAiDelegation(value);
      if (d) out[id] = d;
    }
    return out;
  } catch {
    return {};
  }
};

const writeAll = async (map: DelegationMap): Promise<void> => {
  try {
    await AsyncStorage.setItem(storageKey(await scopeKey()), encrypt(JSON.stringify(map)));
  } catch {
    /* best-effort */
  }
};

export const setDelegation = async (taskId: string, delegation: AiTaskDelegation): Promise<void> => {
  const map = await getDelegations();
  map[taskId] = delegation;
  await writeAll(map);
  // Remember this choice as the default for the next task the user delegates.
  const defaults = extractDelegationDefaults(delegation);
  if (defaults) {
    try { await AsyncStorage.setItem(defaultsStorageKey(await scopeKey()), encrypt(JSON.stringify(defaults))); } catch { /* best-effort */ }
  }
};

/** The last delegation choice the user made (model/source/budget/…), or null. */
export const getDelegationDefaults = async (): Promise<DelegationDefaults | null> => {
  try {
    const raw = await AsyncStorage.getItem(defaultsStorageKey(await scopeKey()));
    if (!raw) return null;
    return parseDelegationDefaults(safeDecrypt(raw, raw));
  } catch {
    return null;
  }
};

export const patchDelegation = async (taskId: string, patch: Partial<AiTaskDelegation>): Promise<AiTaskDelegation | null> => {
  const map = await getDelegations();
  const existing = map[taskId];
  if (!existing) return null;
  const next = { ...existing, ...patch };
  map[taskId] = next;
  await writeAll(map);
  return next;
};

export const removeDelegation = async (taskId: string): Promise<void> => {
  const map = await getDelegations();
  if (map[taskId]) {
    delete map[taskId];
    await writeAll(map);
  }
};

/** Merge the delegation map onto a list of tasks (sets task.aiAgent in memory). */
export const mergeDelegations = (tasks: Task[], map: DelegationMap): Task[] =>
  (tasks || []).map((t) => (map[t._id] ? { ...t, aiAgent: map[t._id] } : t));

/** Reset the cached scope (call on logout / user switch). */
export const resetDelegationScope = (): void => { cachedScope = null; };

// --- Transparent run log: what the agent did/read on its last run, per task. ---
export interface AgentAccessRecord { kind: string; id?: string; title?: string; at: string }
export interface AgentRunLogEntry {
  at: string;
  stopped: string;
  summary: string;
  accesses: AgentAccessRecord[];
}
export type RunLogMap = Record<string, AgentRunLogEntry>;
const runLogKey = (scope: string) => `ai_task_runlog_${scope}`;

export const getRunLog = async (): Promise<RunLogMap> => {
  try {
    const raw = await AsyncStorage.getItem(runLogKey(await scopeKey()));
    if (!raw) return {};
    const parsed = JSON.parse(safeDecrypt(raw, raw) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const setRunLogEntry = async (taskId: string, entry: AgentRunLogEntry): Promise<void> => {
  try {
    const map = await getRunLog();
    // Keep the log bounded: cap accesses per entry.
    map[taskId] = { ...entry, accesses: (entry.accesses || []).slice(0, 50) };
    await AsyncStorage.setItem(runLogKey(await scopeKey()), encrypt(JSON.stringify(map)));
  } catch {
    /* best-effort */
  }
};
