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

export type AgentStopReason = 'done' | 'maxSteps' | 'loop' | 'error' | 'aborted';

export interface AgentRunResult {
  steps: AgentStep[];
  finalText: string;
  toolCalls: AgentToolCall[];
  accesses: AgentAccess[];
  stopped: AgentStopReason;
}

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

export const runAgentTask = async (params: {
  system: string;
  goal: string;
  deps: AgentRunDeps;
  maxSteps?: number;
  history?: ChatMessage[];
}): Promise<AgentRunResult> => {
  const { system, goal, deps } = params;
  const maxSteps = params.maxSteps ?? 12;
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

  for (let i = 0; i < maxSteps; i += 1) {
    if (deps.isAborted?.()) { stopped = 'aborted'; break; }

    let assistant: string;
    try {
      assistant = await deps.invokeModel(messages);
    } catch (e) {
      finalText = `Modellanrop misslyckades: ${(e as Error)?.message ?? e}`;
      stopped = 'error';
      break;
    }
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
        tc.result = await deps.executeTool(call.tool, call.arguments);
      } catch (e) {
        tc.error = (e as Error)?.message ?? String(e);
      }
      step.toolCalls.push(tc);
      allToolCalls.push(tc);
      messages.push({
        role: 'tool',
        content: `Resultat för ${call.tool}: ${clampJson(tc.error ? { error: tc.error } : tc.result)}`,
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

  return { steps, finalText, toolCalls: allToolCalls, accesses, stopped };
};
