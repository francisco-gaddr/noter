/**
 * Web/Electron AI-task scheduler. Electron's renderer (and a left-open browser
 * tab) is always running, so a simple single-flight poll reliably runs delegated
 * tasks at their dueDate. Mirrors the mobile scheduler.
 */
import { selectDueAiTasks, type Task } from '@repo/shared';
import { useStore } from '../../stores/useStore';
import { getDelegations, mergeDelegations } from './agentDelegations';
import { runScheduledAgentTask } from './agentExecutor';

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 30_000;

export type AgentRunNotice = { taskId: string; title: string; ok: boolean; summary: string };
let listeners: ((n: AgentRunNotice) => void)[] = [];
export const onAgentRun = (cb: (n: AgentRunNotice) => void): (() => void) => {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
};

const currentUserId = (): string | undefined => {
  const u = useStore.getState().user as any;
  return u?._id || u?.id || undefined;
};

export const runDueAgentTasks = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  let ran = 0;
  try {
    const userId = currentUserId();
    const tasks: Task[] = mergeDelegations(useStore.getState().tasks || [], getDelegations(userId));
    for (const task of selectDueAiTasks(tasks)) {
      const outcome = await runScheduledAgentTask(task, { userId });
      ran += 1;
      for (const l of listeners) { try { l({ taskId: task._id, title: task.title, ok: outcome.ok, summary: outcome.summary }); } catch { /* ignore */ } }
    }
  } catch {
    /* best-effort */
  } finally {
    running = false;
  }
  return ran;
};

export const runAgentTaskNow = async (task: Task): Promise<AgentRunNotice | null> => {
  if (running) return null;
  running = true;
  try {
    const userId = currentUserId();
    const map = getDelegations(userId);
    const merged = map[task._id] ? { ...task, aiAgent: map[task._id] } : task;
    if (!merged.aiAgent || merged.aiAgent.assignee !== 'ai') return null;
    const outcome = await runScheduledAgentTask(merged, { userId });
    const notice = { taskId: task._id, title: task.title, ok: outcome.ok, summary: outcome.summary };
    for (const l of listeners) { try { l(notice); } catch { /* ignore */ } }
    return notice;
  } finally {
    running = false;
  }
};

export const startAgentScheduler = (): (() => void) => {
  if (timer) return stopAgentScheduler;
  void runDueAgentTasks();
  timer = setInterval(() => { void runDueAgentTasks(); }, POLL_MS);
  return stopAgentScheduler;
};

export const stopAgentScheduler = (): void => {
  if (timer) { clearInterval(timer); timer = null; }
};
