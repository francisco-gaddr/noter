/**
 * Web/Electron local store of AI-task delegations + run log, keyed by task id.
 * Mirrors apps/mobile/services/ai/agentDelegations: the delegation lives only on
 * this device (encrypted in localStorage), decoupled from the synced task, so a
 * sync round-trip can't strip it. Keep the two in sync.
 */
import {
  encrypt, decrypt, parseAiDelegation,
  extractDelegationDefaults, parseDelegationDefaults,
  type AiTaskDelegation, type DelegationDefaults, type Task,
} from '@repo/shared';

const scope = (userId?: string | null) => (userId ? `:${userId}` : '');
const delKey = (userId?: string | null) => `aiTaskDelegations${scope(userId)}`;
const logKey = (userId?: string | null) => `aiTaskRunLog${scope(userId)}`;
const defaultsKey = (userId?: string | null) => `aiDelegationDefaults${scope(userId)}`;

export type DelegationMap = Record<string, AiTaskDelegation>;
export interface AgentAccessRecord { kind: string; id?: string; title?: string; at: string }
export interface AgentRunLogEntry { at: string; stopped: string; summary: string; accesses: AgentAccessRecord[] }
export type RunLogMap = Record<string, AgentRunLogEntry>;

const readJson = <T>(key: string, fallback: T): T => {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(decrypt(raw) || raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, encrypt(JSON.stringify(value)));
  } catch {
    /* best-effort */
  }
};

export const getDelegations = (userId?: string | null): DelegationMap => {
  const raw = readJson<Record<string, unknown>>(delKey(userId), {});
  const out: DelegationMap = {};
  for (const [id, v] of Object.entries(raw)) {
    const d = parseAiDelegation(v);
    if (d) out[id] = d;
  }
  return out;
};

export const setDelegation = (taskId: string, delegation: AiTaskDelegation, userId?: string | null): void => {
  const map = getDelegations(userId);
  map[taskId] = delegation;
  writeJson(delKey(userId), map);
  // Remember this choice as the default for the next task the user delegates.
  const defaults = extractDelegationDefaults(delegation);
  if (defaults) writeJson(defaultsKey(userId), defaults);
};

/** The last delegation choice the user made (model/source/budget/…), or null. */
export const getDelegationDefaults = (userId?: string | null): DelegationDefaults | null =>
  parseDelegationDefaults(readJson<unknown>(defaultsKey(userId), null));

export const patchDelegation = (taskId: string, patch: Partial<AiTaskDelegation>, userId?: string | null): AiTaskDelegation | null => {
  const map = getDelegations(userId);
  if (!map[taskId]) return null;
  map[taskId] = { ...map[taskId], ...patch };
  writeJson(delKey(userId), map);
  return map[taskId];
};

export const removeDelegation = (taskId: string, userId?: string | null): void => {
  const map = getDelegations(userId);
  if (map[taskId]) { delete map[taskId]; writeJson(delKey(userId), map); }
};

export const mergeDelegations = (tasks: Task[], map: DelegationMap): Task[] =>
  (tasks || []).map((t) => (map[t._id] ? { ...t, aiAgent: map[t._id] } : t));

export const getRunLog = (userId?: string | null): RunLogMap => readJson<RunLogMap>(logKey(userId), {});
export const setRunLogEntry = (taskId: string, entry: AgentRunLogEntry, userId?: string | null): void => {
  const map = getRunLog(userId);
  map[taskId] = { ...entry, accesses: (entry.accesses || []).slice(0, 50) };
  writeJson(logKey(userId), map);
};
