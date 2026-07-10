/**
 * The agent runner — the brain that executes a delegated AI task.
 *
 * Given a system prompt + a goal, it drives a plan → tool-call → observe loop:
 *   1. ask the model what to do,
 *   2. parse any tool calls (same ```json {"tool","arguments"} format the chat uses),
 *   3. execute each tool, feeding results back,
 *   4. repeat until the model stops calling tools, a step cap is hit, or a loop is
 *      detected (identical tool-call set repeated).
 *
 * Everything is dependency-injected (invokeModel, executeTool, onAccess, clock) so
 * it is fully unit-testable with no network and reusable from BOTH the mobile and
 * Electron schedulers — each just supplies its own model-send + tool-executor.
 *
 * Read tools surface an "access" event so the UI can transparently show every note
 * / task / list / instruction the agent looked at.
 */
import type { ChatMessage } from './index';
import { normalizeToolArguments } from './toolArgs';

export type AgentAccessKind = 'note' | 'task' | 'list' | 'project' | 'instruction' | 'search';

export interface AgentAccess {
  kind: AgentAccessKind;
  id?: string;
  title?: string;
  detail?: string;
  at: string;
}

export interface AgentToolCall {
  tool: string;
  arguments: Record<string, any>;
  result?: unknown;
  error?: string;
}

export interface AgentStep {
  index: number;
  assistant: string;
  toolCalls: AgentToolCall[];
}

export type AgentStopReason = 'done' | 'maxSteps' | 'loop' | 'error' | 'aborted' | 'budget';

export interface AgentRunResult {
  steps: AgentStep[];
  finalText: string;
  toolCalls: AgentToolCall[];
  accesses: AgentAccess[];
  stopped: AgentStopReason;
  /** Estimated tokens consumed across all model calls this run (for budgeting/usage). */
  tokensUsed: number;
}

/** Coarse token estimate (~4 chars/token) — no tokenizer dependency, good enough for budget guards. */
export const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);

export interface AgentRunDeps {
  /** Call the chosen model with the running message list, return its text. */
  invokeModel: (messages: ChatMessage[]) => Promise<string>;
  /** Execute one tool call, returning a JSON-serialisable result. */
  executeTool: (tool: string, args: Record<string, any>) => Promise<unknown>;
  /** Notified for every read the agent performs (for the transparent access UI). */
  onAccess?: (access: AgentAccess) => void;
  /** Notified after each completed step (for live progress UI). */
  onStep?: (step: AgentStep) => void;
  /** Cooperative cancellation. */
  isAborted?: () => boolean;
  /** Injectable clock (tests). */
  now?: () => string;
}

const READ_ACCESS_BY_TOOL: Record<string, AgentAccessKind> = {
  list_notes: 'note',
  get_note: 'note',
  list_projects: 'project',
  list_tasklists: 'list',
  list_tasks: 'task',
  get_task: 'task',
};

/** Parse the ```json {"tool","arguments"} ``` blocks the chat format uses. */
export const parseAgentToolCalls = (text: string): { tool: string; arguments: Record<string, any> }[] => {
  const calls: { tool: string; arguments: Record<string, any> }[] = [];
  const blockRegex = /```json([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = blockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item.tool === 'string') {
          calls.push({ tool: item.tool, arguments: normalizeToolArguments(item.tool, item.arguments ?? {}) });
        }
      }
    } catch {
      /* ignore unparseable block */
    }
  }
  return calls;
};

const clampJson = (value: unknown, max = 4000): string => {
  let s: string;
  try { s = JSON.stringify(value); } catch { s = String(value); }
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
};

// Errors get a larger budget than data and are returned as PLAIN TEXT (not JSON-wrapped). A long
// stack trace JSON-wrapped + clamped at 4000 turned into invalid, mid-string-cut JSON — so the agent
// couldn't read the actual failure and couldn't recover. Keep the (root-cause-first) error readable.
const ERROR_MAX = 8000;
const clampError = (msg: string): string =>
  msg.length > ERROR_MAX ? `${msg.slice(0, ERROR_MAX)}…[truncated]` : msg;

/**
 * The `tool`-role message fed back to the model after a tool call. Errors are surfaced clearly and
 * with a bigger budget so the agent can actually recover from a failure; successful data is clamped.
 * Exported so the error-vs-data formatting is unit-tested.
 */
export const formatToolResultMessage = (tool: string, tc: { result?: unknown; error?: string }): string =>
  tc.error
    ? `Fel vid ${tool}: ${clampError(tc.error)}`
    : `Resultat för ${tool}: ${clampJson(tc.result)}`;

/** Race a promise against a hard deadline (timer always cleared — no leaked handles). The
 *  model/tool impls are injected and not all of them enforce their own timeouts, so the loop
 *  defends itself: a provider that connects but never completes must not freeze the run. */
const raceDeadline = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} tog för lång tid (>${Math.round(ms / 1000)}s)`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
};

/** Generous by design: local models on modest hardware stream slowly, and tools may do real
 *  work — these bound "hung forever", not "slow". */
const MODEL_CALL_TIMEOUT_MS = 300_000;
const TOOL_CALL_TIMEOUT_MS = 120_000;

export const runAgentTask = async (params: {
  system: string;
  goal: string;
  deps: AgentRunDeps;
  maxSteps?: number;
  history?: ChatMessage[];
  /** Soft token cap for this run; the loop stops before a call that would exceed it. */
  tokenBudget?: number;
}): Promise<AgentRunResult> => {
  const { system, goal, deps } = params;
  const maxSteps = params.maxSteps ?? 12;
  const tokenBudget = params.tokenBudget && params.tokenBudget > 0 ? params.tokenBudget : undefined;
  const nowIso = () => (deps.now ? deps.now() : new Date().toISOString());

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...(params.history ?? []),
    { role: 'user', content: goal },
  ];

  const steps: AgentStep[] = [];
  const allToolCalls: AgentToolCall[] = [];
  const accesses: AgentAccess[] = [];
  const seenSignatures = new Set<string>();
  let finalText = '';
  let stopped: AgentStopReason = 'done';
  let tokensUsed = 0;

  for (let i = 0; i < maxSteps; i += 1) {
    if (deps.isAborted?.()) { stopped = 'aborted'; break; }

    // Token budget: stop before a call we estimate would exceed the cap (but always
    // allow the first call so a tiny budget still does one step of useful work).
    const promptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (tokenBudget && i > 0 && tokensUsed + promptTokens > tokenBudget) { stopped = 'budget'; break; }

    let assistant: string;
    try {
      assistant = await raceDeadline(deps.invokeModel(messages), MODEL_CALL_TIMEOUT_MS, 'Modellanropet');
    } catch (e) {
      finalText = `Modellanrop misslyckades: ${(e as Error)?.message ?? e}`;
      stopped = 'error';
      break;
    }
    tokensUsed += promptTokens + estimateTokens(assistant);
    finalText = assistant;

    const calls = parseAgentToolCalls(assistant);
    const step: AgentStep = { index: i, assistant, toolCalls: [] };

    if (calls.length === 0) {
      steps.push(step);
      deps.onStep?.(step);
      stopped = 'done';
      break;
    }

    // Anti-loop: identical set of tool calls repeated → stop.
    const signature = calls.map((c) => `${c.tool}:${JSON.stringify(c.arguments)}`).sort().join('|');
    if (seenSignatures.has(signature)) {
      steps.push(step);
      deps.onStep?.(step);
      stopped = 'loop';
      break;
    }
    seenSignatures.add(signature);

    messages.push({ role: 'assistant', content: assistant });

    for (const call of calls) {
      if (deps.isAborted?.()) { stopped = 'aborted'; break; }
      const tc: AgentToolCall = { tool: call.tool, arguments: call.arguments };

      const kind = READ_ACCESS_BY_TOOL[call.tool] ?? (call.tool === 'mcp_call_tool' ? 'search' : undefined);
      if (kind) {
        const access: AgentAccess = {
          kind,
          id: typeof call.arguments?.id === 'string' ? call.arguments.id : undefined,
          title: typeof call.arguments?.title === 'string' ? call.arguments.title : undefined,
          at: nowIso(),
        };
        accesses.push(access);
        deps.onAccess?.(access);
      }

      try {
        tc.result = await raceDeadline(deps.executeTool(call.tool, call.arguments), TOOL_CALL_TIMEOUT_MS, `Verktyget ${call.tool}`);
      } catch (e) {
        tc.error = (e as Error)?.message ?? String(e);
      }
      step.toolCalls.push(tc);
      allToolCalls.push(tc);
      messages.push({
        role: 'tool',
        content: formatToolResultMessage(call.tool, tc),
      });
    }

    steps.push(step);
    deps.onStep?.(step);
    if (stopped === 'aborted') break;
  }

  if (stopped === 'done' && steps.length >= maxSteps) {
    const last = steps[steps.length - 1];
    if (last && last.toolCalls.length > 0) stopped = 'maxSteps';
  }

  return { steps, finalText, toolCalls: allToolCalls, accesses, stopped, tokensUsed };
};
