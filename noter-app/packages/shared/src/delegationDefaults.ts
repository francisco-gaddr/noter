/**
 * Last-delegation defaults — make giving a task to the AI agent feel "one tap".
 *
 * The user's verbatim ask: the LAST delegation choice should be the DEFAULT for the
 * next task they create (on mobile AND Electron). So when someone delegates a task
 * to e.g. "Hermes / qwen2.5, standard context, run on backend, 4k tokens", the next
 * time they flip the "delegate to AI" switch it pre-fills exactly that, instead of a
 * cold default. Simple by default, but every knob is still there to change.
 *
 * This module is the pure, shared contract:
 *  - `DelegationDefaults` is the *reusable* slice of a delegation — the model/source/
 *    behaviour choices — WITHOUT per-task runtime state (status, result, runCount,
 *    lastRunAt) or the task's own free-text instructions.
 *  - `extractDelegationDefaults(d)` pulls that slice out of a delegation the user just
 *    configured, so the platform can persist it locally (grouped under the AI keys).
 *  - `applyDelegationDefaults(defaults)` builds a fresh AI delegation pre-filled from
 *    those defaults, ready to attach to a new task.
 *
 * The platform layers (mobile SecureStore / web localStorage) only store + load this
 * object; all the shaping lives here and is unit-tested once.
 */
import type { AiTaskDelegation, AiTaskSource } from './agentTasks';
import type { ContextLevel } from './contextLevels';

/** The reusable, task-independent slice of a delegation (what becomes the next default). */
export interface DelegationDefaults {
  source?: AiTaskSource;
  provider?: string;
  model?: string;
  baseUrl?: string;
  localOnly?: boolean;
  toolUse?: boolean;
  contextLevel?: ContextLevel;
  role?: string;
  runOnBackend?: boolean;
  budget?: AiTaskDelegation['budget'];
  notify?: AiTaskDelegation['notify'];
}

const num = (v: unknown): number | undefined => (Number.isFinite(v as number) ? Number(v) : undefined);

/** Keep only finite, positive budget fields (drops zeros/empties so "no cap" stays no cap). */
const cleanBudget = (b?: AiTaskDelegation['budget']): AiTaskDelegation['budget'] | undefined => {
  if (!b || typeof b !== 'object') return undefined;
  const out: NonNullable<AiTaskDelegation['budget']> = {};
  const keys: (keyof NonNullable<AiTaskDelegation['budget']>)[] = ['maxStepsPerRun', 'maxRuns', 'maxTokens', 'maxCredits'];
  for (const k of keys) {
    const n = num(b[k]);
    if (n !== undefined && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
};

/** Pull the reusable defaults out of a delegation the user just configured. */
export const extractDelegationDefaults = (d?: AiTaskDelegation | null): DelegationDefaults | null => {
  if (!d || d.assignee !== 'ai') return null;
  return {
    source: d.source,
    provider: d.provider,
    model: d.model,
    baseUrl: d.baseUrl,
    localOnly: d.localOnly,
    toolUse: d.toolUse,
    contextLevel: d.contextLevel,
    role: d.role && d.role.trim() ? d.role.trim() : undefined,
    runOnBackend: d.runOnBackend,
    budget: cleanBudget(d.budget),
    notify: d.notify && typeof d.notify === 'object'
      ? { onStart: !!d.notify.onStart, onFinish: d.notify.onFinish !== false }
      : undefined,
  };
};

/**
 * Tolerantly parse stored defaults (object or JSON string). Returns null when
 * absent/invalid so the caller falls back to the cold default.
 */
export const parseDelegationDefaults = (raw: unknown): DelegationDefaults | null => {
  if (raw == null || raw === '') return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const source: AiTaskSource | undefined =
    obj.source === 'local' || obj.source === 'hermes' || obj.source === 'api' ? obj.source : undefined;
  return {
    source,
    provider: typeof obj.provider === 'string' ? obj.provider : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    localOnly: obj.localOnly === undefined ? undefined : !!obj.localOnly,
    toolUse: obj.toolUse === undefined ? undefined : !!obj.toolUse,
    contextLevel: ['minimal', 'fast', 'standard', 'deep'].includes(obj.contextLevel) ? obj.contextLevel : undefined,
    role: typeof obj.role === 'string' && obj.role.trim() ? obj.role.trim() : undefined,
    runOnBackend: obj.runOnBackend === undefined ? undefined : !!obj.runOnBackend,
    budget: cleanBudget(obj.budget),
    notify: obj.notify && typeof obj.notify === 'object'
      ? { onStart: !!obj.notify.onStart, onFinish: obj.notify.onFinish !== false }
      : undefined,
  };
};

/**
 * Build a fresh AI delegation from saved defaults (or a sensible cold default when
 * none). The result is `assignee: 'ai'` with clean runtime state, ready to attach to
 * a new task. `localOnly`/`toolUse` default to false/true when unset.
 */
export const applyDelegationDefaults = (defaults?: DelegationDefaults | null): AiTaskDelegation => ({
  assignee: 'ai',
  source: defaults?.source ?? 'api',
  provider: defaults?.provider,
  model: defaults?.model,
  baseUrl: defaults?.baseUrl,
  localOnly: defaults?.localOnly ?? false,
  toolUse: defaults?.toolUse ?? true,
  contextLevel: defaults?.contextLevel,
  role: defaults?.role,
  runOnBackend: defaults?.runOnBackend ?? false,
  budget: cleanBudget(defaults?.budget),
  notify: defaults?.notify,
  status: 'idle',
  runCount: 0,
});
