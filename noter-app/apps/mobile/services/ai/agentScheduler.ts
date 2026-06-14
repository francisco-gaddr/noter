/**
 * Foreground AI-task scheduler (mobile).
 *
 * Background execution on iOS/Android is best-effort only (expo-background-task
 * grants ~15min+ windows, 30s budget — not precise), so precise, reliable runs
 * happen while the app is OPEN: a light poll checks for due delegated tasks and
 * runs them one at a time. (A background catch-up + local notification at the due
 * time are the complementary best-effort layers — see Doc/adr.)
 *
 * Runs are single-flighted (never two agent runs at once) and each task is run at
 * most once per scheduler tick; status is persisted so it isn't re-run.
 */
import { AppState } from 'react-native';
import { selectDueAiTasks, type Task } from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { getDelegations, mergeDelegations } from './agentDelegations';
import { runScheduledAgentTask } from './agentExecutor';

let running = false;          // single-flight guard for an active agent run
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

const POLL_MS = 30_000;

export type AgentRunNotice = { taskId: string; title: string; ok: boolean; summary: string };

let listeners: ((notice: AgentRunNotice) => void)[] = [];
export const onAgentRun = (cb: (n: AgentRunNotice) => void): (() => void) => {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
};

/** Run any due delegated tasks now (used by the poll and by manual "run now"). */
export const runDueAgentTasks = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  let ran = 0;
  try {
    const map = await getDelegations();
    const tasks: Task[] = mergeDelegations(useStore.getState().tasks || [], map);
    const due = selectDueAiTasks(tasks);
    for (const task of due) {
      const outcome = await runScheduledAgentTask(task);
      ran += 1;
      for (const l of listeners) {
        try { l({ taskId: task._id, title: task.title, ok: outcome.ok, summary: outcome.summary }); } catch { /* ignore */ }
      }
    }
  } catch {
    /* best-effort */
  } finally {
    running = false;
  }
  return ran;
};

/** Run a specific delegated task immediately, regardless of dueDate. */
export const runAgentTaskNow = async (task: Task): Promise<AgentRunNotice | null> => {
  if (running) return null;
  running = true;
  try {
    const map = await getDelegations();
    const merged = map[task._id] ? { ...task, aiAgent: map[task._id] } : task;
    if (!merged.aiAgent || merged.aiAgent.assignee !== 'ai') return null;
    const outcome = await runScheduledAgentTask(merged);
    const notice = { taskId: task._id, title: task.title, ok: outcome.ok, summary: outcome.summary };
    for (const l of listeners) { try { l(notice); } catch { /* ignore */ } }
    return notice;
  } finally {
    running = false;
  }
};

/** Start the foreground poll (no-op if already started). */
export const startAgentScheduler = (): (() => void) => {
  if (timer) return stopAgentScheduler;
  // Kick once on start, then poll while the app is active.
  void runDueAgentTasks();
  timer = setInterval(() => {
    if (AppState.currentState === 'active') void runDueAgentTasks();
  }, POLL_MS);
  // Immediate catch-up the moment the app comes back to the foreground, so tasks
  // that came due while we were backgrounded (where OS wake-ups are best-effort and
  // ~15 min apart) run right away instead of waiting for the next 30s poll tick.
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void runDueAgentTasks();
  });
  return stopAgentScheduler;
};

export const stopAgentScheduler = (): void => {
  if (timer) { clearInterval(timer); timer = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
};
