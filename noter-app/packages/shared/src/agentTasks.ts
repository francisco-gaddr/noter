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
  /** Base URL for source='hermes' (self-hosted Ollama/LM Studio). */
  baseUrl?: string;
  /** Extra instructions beyond the task title/description. */
  instructions?: string;
  /** How much data/search the agent may use (minimal/fast/standard/deep). */
  contextLevel?: import('./contextLevels').ContextLevel;
  /**
   * Agent "role"/persona for this task — a short steer prepended to the system
   * prompt (e.g. "Planerare", "Researcher"). Our own lightweight take on the
   * agents-as-employees model popularised by the MIT-licensed paperclipai/paperclip
   * orchestration project; implemented from scratch, not derived from their code.
   */
  role?: string;
  /** Per-agent budget guard rails (caps how hard one task may work). */
  budget?: {
    /** Max steps in a single run (overrides AGENT_MAX_STEPS, clamped 1..AGENT_MAX_STEPS). */
    maxStepsPerRun?: number;
    /** Max total runs across the task's life (overrides AGENT_MAX_RUNS_PER_TASK). */
    maxRuns?: number;
    /**
     * Soft token cap for a single run. Mirrors how Paperclip meters work by token
     * spend: the runner estimates prompt+completion tokens per step and stops once
     * this is reached, so a delegated task can't silently burn a large budget. 0 /
     * undefined = no token cap (only the step/run caps apply).
     */
    maxTokens?: number;
    /**
     * Credit cap for a single run, the user-facing unit. Converted to a token cap
     * via CREDITS_TO_TOKENS so the same runner enforcement covers both. The
     * effective token cap is the tighter of maxTokens and maxCredits·rate.
     */
    maxCredits?: number;
  };
  /**
   * Run on the always-on backend (Pi) instead of (only) the device. Opt-in. The
   * backend runs it at dueDate using the configured source/model — best for
   * Hermes/Ollama (the Pi reaches its own Ollama with no key). When false, only
   * the foreground device schedulers run it.
   */
  runOnBackend?: boolean;
  /** Push-notification preferences for this AI task. */
  notify?: {
    /** Notify when the agent starts the task. */
    onStart?: boolean;
    /** Notify when the agent finishes (default true for AI tasks). */
    onFinish?: boolean;
  };
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
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    localOnly: !!obj.localOnly,
    toolUse: obj.toolUse === undefined ? true : !!obj.toolUse,
    instructions: typeof obj.instructions === 'string' ? obj.instructions : undefined,
    contextLevel: ['minimal', 'fast', 'standard', 'deep'].includes(obj.contextLevel) ? obj.contextLevel : undefined,
    role: typeof obj.role === 'string' ? obj.role : undefined,
    budget: obj.budget && typeof obj.budget === 'object'
      ? {
          maxStepsPerRun: Number.isFinite(obj.budget.maxStepsPerRun) ? Number(obj.budget.maxStepsPerRun) : undefined,
          maxRuns: Number.isFinite(obj.budget.maxRuns) ? Number(obj.budget.maxRuns) : undefined,
          maxTokens: Number.isFinite(obj.budget.maxTokens) ? Number(obj.budget.maxTokens) : undefined,
          maxCredits: Number.isFinite(obj.budget.maxCredits) ? Number(obj.budget.maxCredits) : undefined,
        }
      : undefined,
    runOnBackend: !!obj.runOnBackend,
    notify: obj.notify && typeof obj.notify === 'object'
      ? { onStart: !!obj.notify.onStart, onFinish: obj.notify.onFinish === undefined ? true : !!obj.notify.onFinish }
      : undefined,
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

/** Effective steps-per-run for a delegation, clamped to the hard cap. */
export const resolveMaxSteps = (d?: AiTaskDelegation | null): number => {
  const want = d?.budget?.maxStepsPerRun;
  if (!Number.isFinite(want as number)) return AGENT_MAX_STEPS;
  return Math.max(1, Math.min(AGENT_MAX_STEPS, Math.floor(want as number)));
};

/**
 * Conversion rate from the user-facing "credit" unit to estimated tokens. One
 * credit ≈ 1k tokens — a coarse, transparent rate so a credit cap maps onto the
 * same token-budget enforcement in the runner (mirrors Paperclip's token-metered
 * credits without copying its accounting).
 */
export const CREDITS_TO_TOKENS = 1000;

/**
 * Effective per-run token cap for a delegation, or undefined for no cap. Takes the
 * tighter of an explicit maxTokens and maxCredits·CREDITS_TO_TOKENS so the runner
 * enforces both with one number.
 */
export const resolveTokenBudget = (d?: AiTaskDelegation | null): number | undefined => {
  const caps: number[] = [];
  const t = d?.budget?.maxTokens;
  if (Number.isFinite(t as number) && (t as number) > 0) caps.push(Math.floor(t as number));
  const c = d?.budget?.maxCredits;
  if (Number.isFinite(c as number) && (c as number) > 0) caps.push(Math.floor((c as number) * CREDITS_TO_TOKENS));
  return caps.length ? Math.min(...caps) : undefined;
};

/** True when a task has hit its run budget and must not run again. */
export const isOverRunBudget = (d?: AiTaskDelegation | null): boolean => {
  const cap = Number.isFinite(d?.budget?.maxRuns as number)
    ? Math.max(1, Math.floor(d!.budget!.maxRuns as number))
    : AGENT_MAX_RUNS_PER_TASK;
  return (d?.runCount || 0) >= cap;
};
