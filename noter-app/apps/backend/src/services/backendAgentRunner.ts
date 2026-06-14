/**
 * Backend AI-agent runner — the always-on (Pi) executor for delegated AI tasks.
 *
 * When a task is delegated to the AI agent with `runOnBackend`, the backend runs
 * it at its dueDate without any device being open. It reuses the SAME shared,
 * tested brain (@repo/ai runAgentTask), with:
 *   - invokeModel → the configured self-hosted model (Ollama/LM Studio, OpenAI-
 *     compatible). The Pi reaches its own Ollama with no API key, so Hermes/local
 *     tasks run server-side for free. (source='api' needs a key the server doesn't
 *     hold — those stay device-run.)
 *   - executeTool → server-side Task/Note model operations, scoped to the user.
 *
 * Lifecycle is persisted on the task's encrypted `aiAgent` field; push
 * notifications are sent per the task's notify settings; socket events keep open
 * clients live. Single-flight, with the shared loop/step guards.
 */
import Task from '../models/Task';
import Note from '../models/Note';
import { encrypt, decrypt, parseAiDelegation, serializeAiDelegation, resolveMaxSteps, isOverRunBudget, type AiTaskDelegation } from '@repo/shared';
import { runAgentTask, type ChatMessage } from '@repo/ai';
import { sendPushToUser } from './expoPush';
import logger from '../utils/logger';

type Io = { to?: (room: string) => { emit?: (event: string, payload: unknown) => void } } | undefined;

const dec = (v?: string | null): string => (v ? decrypt(v) || v : '');
const enc = (v: string): string => encrypt(v);
const decBool = (v?: string | null): boolean => dec(v) === 'true';

const DEFAULT_OLLAMA = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';

const resolveChatUrl = (baseUrl?: string): string => {
  const raw = (baseUrl || DEFAULT_OLLAMA).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(raw)) return raw;
  if (/\/v1$/.test(raw)) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
};

const TIMEOUT_MS = 60_000;

/** invokeModel for a self-hosted OpenAI-compatible endpoint (Ollama/LM Studio). */
const buildInvokeModel = (delegation: AiTaskDelegation) => async (messages: ChatMessage[]): Promise<string> => {
  const url = resolveChatUrl(delegation.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: delegation.model,
        messages: messages.map((m) => ({ role: m.role === 'tool' ? 'assistant' : m.role, content: m.content || '' })),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const json: any = await res.json();
    return String(json?.choices?.[0]?.message?.content || '');
  } finally {
    clearTimeout(timer);
  }
};

const noteType = (n: any): string => {
  const t = dec(n.type);
  return t === 'project' || t === 'task_list' ? t : 'note';
};

/** Server-side tool executor over the Mongoose models, scoped to one user. */
const buildToolExecutor = (userId: string, io: Io) => {
  const emit = (event: string, payload: unknown) => { try { io?.to?.(`user:${userId}`)?.emit?.(event, payload); } catch { /* best-effort */ } };
  return async (tool: string, args: Record<string, any>): Promise<unknown> => {
    switch (tool) {
      case 'list_tasks': {
        const tasks = await Task.find({ userId }).limit(200).lean();
        return { tasks: tasks.map((t) => ({ _id: String(t._id), title: dec(t.title), completed: decBool(t.completed), dueDate: dec(t.dueDate), priority: dec(t.priority), parentNoteId: t.parentNoteId ? String(t.parentNoteId) : null })) };
      }
      case 'get_task': {
        const t = await Task.findOne({ _id: args.id, userId }).lean();
        return { task: t ? { _id: String(t._id), title: dec(t.title), description: dec(t.description), completed: decBool(t.completed), dueDate: dec(t.dueDate) } : null };
      }
      case 'list_notes':
      case 'list_projects':
      case 'list_tasklists': {
        const wanted = tool === 'list_projects' ? 'project' : tool === 'list_tasklists' ? 'task_list' : 'note';
        const notes = await Note.find({ userId }).limit(200).lean();
        return { notes: notes.filter((n) => noteType(n) === wanted).map((n) => ({ id: String(n._id), title: dec(n.title) })) };
      }
      case 'get_note': {
        const n = await Note.findOne({ _id: args.id, userId }).lean();
        return { note: n ? { _id: String(n._id), title: dec(n.title), content: dec(n.content) } : null };
      }
      case 'create_task': {
        const now = new Date().toISOString();
        const t = await Task.create({
          userId, title: enc(args.title || 'Uppgift'), description: enc(args.description || ''),
          dueDate: args.dueDate ? enc(args.dueDate) : null, completed: enc('false'),
          priority: enc(args.priority || 'medium'), parentNoteId: args.parentNoteId || null,
          reminderEnabled: enc(String(!!args.reminderEnabled)), createdAt: enc(now), updatedAt: enc(now),
        });
        emit('task:created', t);
        return { task: { _id: String(t._id) } };
      }
      case 'update_task':
      case 'complete_task': {
        const updates = tool === 'complete_task' ? { completed: true } : (args.updates || args);
        const set: any = { updatedAt: enc(new Date().toISOString()) };
        if (updates.title !== undefined) set.title = enc(String(updates.title));
        if (updates.description !== undefined) set.description = enc(String(updates.description));
        if (updates.completed !== undefined) set.completed = enc(String(!!updates.completed));
        if (updates.dueDate !== undefined) set.dueDate = updates.dueDate ? enc(String(updates.dueDate)) : null;
        if (updates.priority !== undefined) set.priority = enc(String(updates.priority));
        const t = await Task.findOneAndUpdate({ _id: args.id, userId }, { $set: set }, { new: true });
        if (t) emit('task:updated', t);
        return { ok: !!t };
      }
      case 'create_note':
      case 'create_project':
      case 'create_tasklist': {
        const type = tool === 'create_project' ? 'project' : tool === 'create_tasklist' ? 'task_list' : 'note';
        const now = new Date().toISOString();
        const n = await Note.create({
          userId, title: enc(args.title || 'Untitled'), content: enc(args.content || ''), tags: [],
          parentId: args.parentId || null, type: enc(type), locked: enc('false'), createdAt: enc(now), updatedAt: enc(now),
        });
        emit('note:created', n);
        return { note: { _id: String(n._id) } };
      }
      case 'update_note': {
        const updates = args.updates || args;
        const set: any = { updatedAt: enc(new Date().toISOString()) };
        if (updates.title !== undefined) set.title = enc(String(updates.title));
        if (updates.content !== undefined) set.content = enc(String(updates.content));
        const n = await Note.findOneAndUpdate({ _id: args.id, userId }, { $set: set }, { new: true });
        if (n) emit('note:updated', n);
        return { ok: !!n };
      }
      default:
        return { error: `Okänt verktyg: ${tool}` };
    }
  };
};

const persistDelegation = async (taskId: string, delegation: AiTaskDelegation) => {
  await Task.updateOne({ _id: taskId }, { $set: { aiAgent: enc(serializeAiDelegation(delegation)), updatedAt: enc(new Date().toISOString()) } }).catch(() => undefined);
};

let running = false;

/** Run all due backend-delegated AI tasks. Single-flight; called by the cron. */
export const runDueBackendAgentTasks = async (io?: Io): Promise<number> => {
  if (running) return 0;
  running = true;
  let ran = 0;
  try {
    const candidates = await Task.find({ aiAgent: { $ne: '' } }).limit(50).lean();
    const nowMs = Date.now();
    for (const t of candidates) {
      const delegation = parseAiDelegation(dec((t as any).aiAgent));
      if (!delegation || delegation.assignee !== 'ai' || !delegation.runOnBackend) continue;
      if (delegation.status === 'running' || delegation.status === 'done') continue;
      if (isOverRunBudget(delegation)) continue;
      if (decBool((t as any).completed)) continue;
      const due = dec((t as any).dueDate);
      const dueMs = due ? new Date(due).getTime() : NaN;
      if (!Number.isFinite(dueMs) || dueMs > nowMs || nowMs - dueMs > 24 * 60 * 60 * 1000) continue;
      // Only self-hosted sources run server-side (no key needed).
      if (delegation.source === 'api') {
        await persistDelegation(String(t._id), { ...delegation, status: 'error', result: 'API-källa kräver enheten (servern har ingen nyckel). Använd Hermes/lokal för serverkörning.' });
        continue;
      }
      await runOne(t as any, delegation, io);
      ran += 1;
    }
  } catch (err) {
    logger.warn('backendAgentRunner.tick-failed', { error: (err as Error)?.message });
  } finally {
    running = false;
  }
  return ran;
};

const runOne = async (task: any, delegation: AiTaskDelegation, io?: Io): Promise<void> => {
  const userId = task.userId as string;
  const title = dec(task.title);
  const notify = delegation.notify ?? { onFinish: true };

  await persistDelegation(String(task._id), { ...delegation, status: 'running', lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });
  if (notify.onStart) await sendPushToUser(userId, { title: 'AI-agent startade', body: `"${title}" körs nu på servern.`, data: { taskId: String(task._id) } }).catch(() => undefined);

  const system = [
    delegation.role ? `Din roll: ${delegation.role}.` : 'Du är en autonom AI-agent som kör på en alltid-på-server och utför en delegerad uppgift.',
    'Arbeta i korta steg med tool calls i ```json {"tool","arguments"} ``` format. Wrappa ALDRIG fälten i en extra "args"-nivå.',
    'Verktyg: list_tasks, get_task, list_notes, list_projects, list_tasklists, get_note, create_task, update_task, complete_task, create_note, update_note.',
    `Aktuell tid (UTC): ${new Date().toISOString()}.`,
    'Bocka av uppgiften med complete_task när målet är klart. Du kan skapa framtida uppgifter åt dig själv (create_task med dueDate).',
    `Din uppgift: "${title}".`,
    dec(task.description) ? `Beskrivning: ${dec(task.description)}` : '',
    delegation.instructions ? `Extra instruktioner: ${delegation.instructions}` : '',
    `Uppgiftens id: ${String(task._id)}.`,
  ].filter(Boolean).join('\n');

  let outcome: { ok: boolean; summary: string; stopped: string };
  try {
    const result = await runAgentTask({
      system,
      goal: `Utför uppgiften "${title}" nu och bocka av den när den är klar.`,
      maxSteps: resolveMaxSteps(delegation),
      deps: { invokeModel: buildInvokeModel(delegation), executeTool: buildToolExecutor(userId, io) },
    });
    outcome = { ok: result.stopped === 'done', summary: (result.finalText || '').slice(0, 400) || `Avslutad (${result.stopped}).`, stopped: result.stopped };
  } catch (err) {
    outcome = { ok: false, summary: `Fel: ${(err as Error)?.message || err}`, stopped: 'error' };
  }

  await persistDelegation(String(task._id), { ...delegation, status: outcome.ok ? 'done' : 'error', result: outcome.summary, lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });
  if (notify.onFinish !== false) {
    await sendPushToUser(userId, { title: outcome.ok ? 'AI-agent klar' : 'AI-agent: problem', body: `"${title}": ${outcome.summary.slice(0, 120)}`, data: { taskId: String(task._id) } }).catch(() => undefined);
  }
  logger.info('backendAgentRunner.ran', { taskId: String(task._id), stopped: outcome.stopped });
};
