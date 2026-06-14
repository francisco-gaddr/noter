/**
 * Scheduled AI-agent tasks — the shared data contract + pure scheduling logic.
 *
 * A task can be delegated to the user (normal) or to the AI agent. An AI task
 * carries everything the runner needs: which model source/model to use, whether
 * it runs fully local (no sync/tracking), whether it may use tools, and free-form
 * instructions. At its dueDate a scheduler (mobile foreground / Electron) picks it
 * up and runs the agent (see @repo/ai runAgentTask).
 *
 * All of this is one structured field on Task (`aiAgent`) so the backend only
 * needs a single encrypted column. The logic here is pure + unit-tested; the
 * platform schedulers are thin wrappers around `selectDueAiTasks`.
 */
import type { Task } from './types';

export type AiTaskSource = 'local' | 'hermes' | 'api';
export type AgentStatus = 'idle' | 'scheduled' | 'running' | 'done' | 'error';

export interface AiTaskDelegation {
  /** 'ai' means the agent runs it; 'user' is a normal task (default). */
  assignee: 'user' | 'ai';
  /** Where the model runs. */
  source?: AiTaskSource;
  /** Provider id for source='api'|'hermes' (e.g. 'groq', 'gemini', a custom id). */
  provider?: string;
  /** Model id to use. */
  model?: string;
  /** Run fully local: never sync the task/result, no usage tracking. Always encrypted. */
  localOnly?: boolean;
  /** Allow the agent to use tools (create/update/read notes+tasks, search). */
  toolUse?: boolean;
  /** Extra instructions beyond the task title/description. */
  instructions?: string;
  /** Execution state, updated by the runner. */
  status?: AgentStatus;
  /** ISO timestamp of the last run attempt. */
  lastRunAt?: string;
  /** Short human summary of what the agent did on the last run. */
  result?: string;
  /** Number of times this task has been run (loop/runaway guard across runs). */
  runCount?: number;
}

/** True when a delegation means "the AI agent runs this". */
export const isAiTask = (d?: AiTaskDelegation | null): d is AiTaskDelegation =>
  !!d && d.assignee === 'ai';

/**
 * Tolerantly parse a stored delegation (object already, or a JSON string from the
 * encrypted column). Returns null when absent/invalid so callers treat it as a
 * normal user task.
 */
export const parseAiDelegation = (raw: unknown): AiTaskDelegation | null => {
  if (raw == null || raw === '') return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null') return null;
    try { obj = JSON.parse(trimmed); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const assignee = obj.assignee === 'ai' ? 'ai' : 'user';
  const source: AiTaskSource | undefined =
    obj.source === 'local' || obj.source === 'hermes' || obj.source === 'api' ? obj.source : undefined;
  return {
    assignee,
    source,
    provider: typeof obj.provider === 'string' ? obj.provider : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    localOnly: !!obj.localOnly,
    toolUse: obj.toolUse === undefined ? true : !!obj.toolUse,
    instructions: typeof obj.instructions === 'string' ? obj.instructions : undefined,
    status: ['idle', 'scheduled', 'running', 'done', 'error'].includes(obj.status) ? obj.status : 'idle',
    lastRunAt: typeof obj.lastRunAt === 'string' ? obj.lastRunAt : undefined,
    result: typeof obj.result === 'string' ? obj.result : undefined,
    runCount: Number.isFinite(obj.runCount) ? Number(obj.runCount) : 0,
  };
};

/** Serialize a delegation for storage (the encrypted column / local field). */
export const serializeAiDelegation = (d: AiTaskDelegation | null | undefined): string =>
  d ? JSON.stringify(d) : '';

const dueAt = (task: Task): number | null => {
  if (!task.dueDate) return null;
  const t = new Date(task.dueDate).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Which AI tasks are due to run at `now`: delegated to the agent, not completed,
 * not deleted, dueDate reached, and not already running. A task that errored or
 * finished is not re-run unless its dueDate is in the future again (recurrence) —
 * the caller advances dueDate/clears status for recurring tasks.
 *
 * `graceMs` (default 24h) bounds how long after the due time we still auto-run, so
 * a task that came due while the app was closed runs on next open but a very old
 * one doesn't surprise-fire weeks later.
 */
export const selectDueAiTasks = (
  tasks: Task[],
  now: Date = new Date(),
  graceMs = 24 * 60 * 60 * 1000,
): Task[] => {
  const nowMs = now.getTime();
  return (tasks || []).filter((task) => {
    const d = task.aiAgent ?? null;
    if (!isAiTask(d)) return false;
    if (task.completed) return false;
    if (task.deleted === true || task.deleted === 'true') return false;
    if (d.status === 'running' || d.status === 'done') return false;
    const due = dueAt(task);
    if (due == null) return false;
    return due <= nowMs && nowMs - due <= graceMs;
  });
};

/** Cap on agent steps per run and total runs per task — runaway guards. */
export const AGENT_MAX_STEPS = 12;
export const AGENT_MAX_RUNS_PER_TASK = 25;
