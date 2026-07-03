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
import { encrypt, decrypt, parseAiDelegation, serializeAiDelegation, resolveMaxSteps, resolveTokenBudget, isOverRunBudget, AGENT_PLANNING_INSTRUCTIONS, AGENT_LOCK_POLICY, buildSecurityNoteMap, isReadableWithLocks, type SecurityNote, type AiTaskDelegation } from '@repo/shared';
import { runAgentTask, type ChatMessage } from '@repo/ai';
import { sendPushToUser } from './expoPush';
import { enforceQuota } from './quotaTracker';
import { TooManyRequestsError } from '../utils/httpErrors';
import logger from '../utils/logger';

// Per-user daily cap on SERVER-RUN agent tasks. These are the only AI runs that cost the OPERATOR
// (self-hosted Ollama compute + DB writes on the Pi) — provider API calls are billed to the user's
// own client-side key and never touch the backend, so they need no server quota. A generous cap
// stops a runaway/abusive account from monopolising the shared backend. Env-overridable.
const BACKEND_AGENT_DAILY_LIMIT = Number(process.env.BACKEND_AGENT_DAILY_LIMIT) || 200;

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

/**
 * SECURITY: the always-on backend runs the agent with NO unlock session, so it must
 * never read or decrypt a locked note (or a note inside a locked folder). Build a lock
 * map from the raw (still-encrypted) `locked`/`password` fields — parseLockedFlag inside
 * the shared helper service-decrypts the flag — and treat every locked note as
 * permanently unreadable (unlockedIds is empty here, by design).
 */
const loadNoteSecurityMap = async (userId: string): Promise<Map<string, SecurityNote>> => {
  // Minimal projection: the lock map only needs the tree structure + lock signals —
  // never pull title/content ciphertexts for the whole collection per tool call.
  const rows = await Note.find({ userId }).select('_id parentId locked type +password').lean();
  const secNotes: SecurityNote[] = rows.map((n: any) => ({
    _id: String(n._id),
    parentId: n.parentId ? String(n.parentId) : null,
    locked: n.locked,
    password: n.password,
    type: noteType(n),
  }));
  return buildSecurityNoteMap(secNotes);
};

/** Server-side tool executor over the Mongoose models, scoped to one user. */
const buildToolExecutor = (userId: string, io: Io) => {
  const emit = (event: string, payload: unknown) => { try { io?.to?.(`user:${userId}`)?.emit?.(event, payload); } catch { /* best-effort */ } };
  return async (tool: string, args: Record<string, any>): Promise<unknown> => {
    switch (tool) {
      case 'list_tasks': {
        const secMap = await loadNoteSecurityMap(userId);
        const tasks = await Task.find({ userId }).limit(200).lean();
        // Drop any task whose parent list/project is locked.
        const readable = tasks.filter((t) => !t.parentNoteId || isReadableWithLocks(secMap.get(String(t.parentNoteId)), secMap));
        return { tasks: readable.map((t) => ({ _id: String(t._id), title: dec(t.title), completed: decBool(t.completed), dueDate: dec(t.dueDate), priority: dec(t.priority), parentNoteId: t.parentNoteId ? String(t.parentNoteId) : null })) };
      }
      case 'get_task': {
        const secMap = await loadNoteSecurityMap(userId);
        const t = await Task.findOne({ _id: args.id, userId }).lean();
        if (t && t.parentNoteId && !isReadableWithLocks(secMap.get(String(t.parentNoteId)), secMap)) {
          return { task: null, error: 'Uppgiften tillhör en låst lista och kan inte läsas.' };
        }
        return { task: t ? { _id: String(t._id), title: dec(t.title), description: dec(t.description), completed: decBool(t.completed), dueDate: dec(t.dueDate) } : null };
      }
      case 'list_notes':
      case 'list_projects':
      case 'list_tasklists': {
        const wanted = tool === 'list_projects' ? 'project' : tool === 'list_tasklists' ? 'task_list' : 'note';
        const secMap = await loadNoteSecurityMap(userId);
        const notes = await Note.find({ userId }).limit(200).lean();
        return {
          notes: notes
            .filter((n) => noteType(n) === wanted)
            .filter((n) => isReadableWithLocks(secMap.get(String(n._id)), secMap)) // SECURITY: exclude locked
            .map((n) => ({ id: String(n._id), title: dec(n.title) })),
        };
      }
      case 'get_note': {
        const secMap = await loadNoteSecurityMap(userId);
        // SECURITY: refuse BEFORE decrypting content — locked notes stay encrypted.
        if (!isReadableWithLocks(secMap.get(String(args.id)), secMap)) {
          return { note: null, error: 'Anteckningen är låst och kan inte läsas eller avkrypteras av AI-agenten.' };
        }
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

  // Fair-use quota: cap server-run agent tasks per user/day (the only operator-cost AI path).
  // On exceed → mark the task and skip. A quota-infra error (DB blip) fails OPEN so a legit run is
  // never blocked by the check itself.
  try {
    await enforceQuota(userId, 'backend-agent-runs', { dayLimit: BACKEND_AGENT_DAILY_LIMIT });
  } catch (err) {
    if (err instanceof TooManyRequestsError) {
      await persistDelegation(String(task._id), { ...delegation, status: 'error', result: `Daglig gräns (${BACKEND_AGENT_DAILY_LIMIT}) för server-körda agentuppgifter nådd. Kör på enheten eller försök imorgon.` });
      return;
    }
    logger.warn('backendAgentRunner.quota-check-failed', { error: (err as Error)?.message });
  }

  await persistDelegation(String(task._id), { ...delegation, status: 'running', lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });
  if (notify.onStart) await sendPushToUser(userId, { title: 'AI-agent startade', body: `"${title}" körs nu på servern.`, data: { taskId: String(task._id) } }).catch(() => undefined);

  const system = [
    delegation.role ? `Din roll: ${delegation.role}.` : 'Du är en autonom AI-agent som kör på en alltid-på-server och utför en delegerad uppgift.',
    AGENT_LOCK_POLICY,
    'Arbeta i korta steg med tool calls i ```json {"tool","arguments"} ``` format. Wrappa ALDRIG fälten i en extra "args"-nivå.',
    'Verktyg: list_tasks, get_task, list_notes, list_projects, list_tasklists, get_note, create_task, update_task, complete_task, create_note, update_note.',
    `Aktuell tid (UTC): ${new Date().toISOString()}.`,
    'Bocka av uppgiften med complete_task när målet är klart. Du kan skapa framtida uppgifter åt dig själv (create_task med dueDate).',
    AGENT_PLANNING_INSTRUCTIONS,
    'Läs dina minnesmappar via list_notes/get_note (projektmappen "AI-agent" eller de mappar uppgiften anger) innan du planerar.',
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
      tokenBudget: resolveTokenBudget(delegation),
      deps: { invokeModel: buildInvokeModel(delegation), executeTool: buildToolExecutor(userId, io) },
    });
    const budgetNote = result.stopped === 'budget' ? ` (tokenbudget nådd, ~${result.tokensUsed} tokens)` : '';
    outcome = { ok: result.stopped === 'done', summary: ((result.finalText || '').slice(0, 400) || `Avslutad (${result.stopped}).`) + budgetNote, stopped: result.stopped };
  } catch (err) {
    outcome = { ok: false, summary: `Fel: ${(err as Error)?.message || err}`, stopped: 'error' };
  }

  await persistDelegation(String(task._id), { ...delegation, status: outcome.ok ? 'done' : 'error', result: outcome.summary, lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });
  if (notify.onFinish !== false) {
    await sendPushToUser(userId, { title: outcome.ok ? 'AI-agent klar' : 'AI-agent: problem', body: `"${title}": ${outcome.summary.slice(0, 120)}`, data: { taskId: String(task._id) } }).catch(() => undefined);
  }
  logger.info('backendAgentRunner.ran', { taskId: String(task._id), stopped: outcome.stopped });
};
